const CONFIG_KEY = "Presets";
const CONFIG_CLAMP_KEY = "ClampToArea";
const CONFIG_CENTER_KEY = "CenterWindow";
const CONFIG_ARRANGE_KEY = "AllWindowsArrangement";
const CONFIG_SPACING_KEY = "GridSpacing";
const MAX_GRID_SPACING = 200;
const ARRANGE_CASCADE = "cascade";
const ARRANGE_GRID = "grid";
const ARRANGE_STACK = "stack";
const CASCADE_STEP = 32;
const DEFAULT_PRESETS = [
    { text: "4:3 800×600",   w: 800,  h: 600  },
    { text: "4:3 1024×768",  w: 1024, h: 768  },
    { text: "16:9 1280×720",  w: 1280, h: 720  },
    { text: "16:9 1600×900",  w: 1600, h: 900  },
    { text: "16:9 1920×1080", w: 1920, h: 1080 },
    { text: "21:9 2560×1080", w: 2560, h: 1080 },
];

function buildLabel(width, height) {
    return width + "×" + height;
}

function sanitizeLabel(label) {
    if (!label) return "";

    return label
        .toString()
        .replace(/[|,]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function parsePresetEntry(entry) {
    if (!entry) return null;

    const trimmed = entry.toString().trim();
    if (!trimmed) return null;

    let label = "";
    let width = 0;
    let height = 0;

    if (trimmed.indexOf("|") !== -1) {
        const parts = trimmed.split("|").map(p => p.trim());
        if (parts.length >= 3) {
            label = parts[0];
            width = parseInt(parts[1], 10);
            height = parseInt(parts[2], 10);
        } else if (parts.length === 2) {
            width = parseInt(parts[0], 10);
            height = parseInt(parts[1], 10);
        } else {
            return null;
        }
    } else {
        const sizeMatch = trimmed.match(/(\d+)\s*[x×]\s*(\d+)/);
        if (!sizeMatch) return null;

        width = parseInt(sizeMatch[1], 10);
        height = parseInt(sizeMatch[2], 10);
        label = trimmed;
    }

    if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }

    label = sanitizeLabel(label);
    if (!label) {
        label = buildLabel(width, height);
    }

    return { text: label, w: width, h: height };
}

function normalizeEntries(value) {
    if (Array.isArray(value)) {
        if (value.length === 1 && typeof value[0] === "string") {
            const single = value[0];
            if (/[;,]/.test(single)) {
                return single.split(/[,;]/).map(item => item.trim()).filter(Boolean);
            }
        }

        return value;
    }
    if (value === null || value === undefined) return [];

    const asString = value.toString();
    if (!asString.trim()) return [];

    return asString.split(/[,;]/).map(item => item.trim()).filter(Boolean);
}

function loadPresets() {
    const entries = normalizeEntries(readConfig(CONFIG_KEY, ""));
    const presets = entries.map(parsePresetEntry).filter(Boolean);

    return presets.length ? presets : DEFAULT_PRESETS;
}

function readPlacementOptions() {
    return {
        clamp: readConfig(CONFIG_CLAMP_KEY, true) === true,
        center: readConfig(CONFIG_CENTER_KEY, true) === true,
    };
}

function readArrangement() {
    // KConfigXT stores the choice name; accept a raw index as well
    const value = String(readConfig(CONFIG_ARRANGE_KEY, "Grid")).trim().toLowerCase();

    if (value === ARRANGE_CASCADE || value === "0") return ARRANGE_CASCADE;
    if (value === ARRANGE_STACK || value === "2") return ARRANGE_STACK;
    return ARRANGE_GRID;
}

function readGridSpacing() {
    const value = parseInt(readConfig(CONFIG_SPACING_KEY, 0), 10);
    if (!isFinite(value) || value < 0) return 0;

    return Math.min(value, MAX_GRID_SPACING);
}

function prepareWindow(win) {
    // Maximized or fullscreen windows ignore geometry changes
    if (win.fullScreen) win.fullScreen = false;
    if (win.maximizeMode) win.setMaximize(false, false);

    // Tiled windows keep snapping back to their tile unless released first
    if (win.tile && typeof win.tile.unmanage === "function") {
        win.tile.unmanage(win);
    }
}

function presetSize(win, area, w, h, clamp) {
    // Apps enforce their own minimum size; plan positions around it.
    // minSize excludes decorations, so add the frame's border size back.
    const min = win.minSize;
    const frame = win.frameGeometry;
    const client = win.clientGeometry;
    const decoWidth = client ? Math.max(0, frame.width - client.width) : 0;
    const decoHeight = client ? Math.max(0, frame.height - client.height) : 0;
    const minWidth = min && min.width > 0 ? Math.ceil(min.width + decoWidth) : 0;
    const minHeight = min && min.height > 0 ? Math.ceil(min.height + decoHeight) : 0;
    const width = Math.max(w, minWidth);
    const height = Math.max(h, minHeight);

    return {
        width: clamp ? Math.min(width, area.width) : width,
        height: clamp ? Math.min(height, area.height) : height,
    };
}

function applyGeometry(win, area, x, y, size, clamp) {
    const maxX = area.x + area.width - size.width;
    const maxY = area.y + area.height - size.height;
    const finalX = clamp ? Math.min(Math.max(area.x, x), maxX) : x;
    const finalY = clamp ? Math.min(Math.max(area.y, y), maxY) : y;

    // On Plasma 6, frameGeometry is usually the right one to move+resize
    win.frameGeometry = {
        x: finalX,
        y: finalY,
        width: size.width,
        height: size.height,
    };
}

function placeWindow(win, w, h, options) {
    prepareWindow(win);

    // MaximizeArea respects panels/docks
    const area = workspace.clientArea(KWin.MaximizeArea, win);
    const size = presetSize(win, area, w, h, options.clamp);

    let x = win.frameGeometry.x;
    let y = win.frameGeometry.y;
    if (options.center) {
        x = area.x + Math.floor((area.width - size.width) / 2);
        y = area.y + Math.floor((area.height - size.height) / 2);
    }

    applyGeometry(win, area, x, y, size, options.clamp);
}

function resizeAndCenter(win, w, h) {
    if (!win || win.deleted) return;

    placeWindow(win, w, h, readPlacementOptions());
}

function listContains(list, matches) {
    // KWin lists may be array-like wrappers; avoid relying on Array methods
    for (let i = 0; i < list.length; i++) {
        if (matches(list[i])) return true;
    }
    return false;
}

function isOnCurrentDesktop(win) {
    if (win.onAllDesktops) return true;

    // Plasma can track a separate current desktop per screen
    const current = workspace.currentDesktopForScreen
        ? workspace.currentDesktopForScreen(win.output)
        : workspace.currentDesktop;
    if (!current) return false;

    return listContains(win.desktops, d => d && d.id === current.id);
}

function isOnCurrentActivity(win) {
    const activities = win.activities;
    if (!activities || activities.length === 0) return true;

    return listContains(activities, a => a === workspace.currentActivity);
}

function isAppWindow(candidate, appClass) {
    return !!candidate
        && !candidate.deleted
        && candidate.normalWindow
        && !candidate.transient
        && !candidate.skipTaskbar
        && candidate.resizeable
        && candidate.moveable
        && candidate.resourceClass === appClass
        && isOnCurrentDesktop(candidate)
        && isOnCurrentActivity(candidate);
}

function collectAppWindows(win) {
    // The invoked window must qualify itself, or the action would only
    // touch other windows (e.g. when invoked from a dialog)
    if (!isAppWindow(win, win.resourceClass)) return [];
    if (!win.resourceClass) return [win];

    const all = workspace.windowList();
    const matches = [];
    for (let i = 0; i < all.length; i++) {
        if (isAppWindow(all[i], win.resourceClass)) matches.push(all[i]);
    }

    // Topmost first, with the window the action was invoked on leading
    matches.sort((a, b) => b.stackingOrder - a.stackingOrder);
    const index = matches.indexOf(win);
    if (index > 0) {
        matches.splice(index, 1);
        matches.unshift(win);
    }

    return matches;
}

function groupByOutput(windows) {
    const groups = [];

    windows.forEach(win => {
        const name = win.output ? win.output.name : "";
        let group = groups.find(g => g.name === name);
        if (!group) {
            group = { name, windows: [] };
            groups.push(group);
        }
        group.windows.push(win);
    });

    return groups;
}

function gridSlots(area, cell, count, spacing) {
    // Spacing goes between windows only, not along the screen edges
    const pitchX = cell.width + spacing;
    const pitchY = cell.height + spacing;
    const maxCols = Math.floor((area.width + spacing) / pitchX);
    const maxRows = Math.floor((area.height + spacing) / pitchY);
    if (maxCols < 1 || maxRows < 1) return null;

    // Use as few rows as possible, then balance the columns
    const rows = Math.ceil(count / maxCols);
    if (rows > maxRows) return null;
    const cols = Math.ceil(count / rows);

    const blockHeight = rows * pitchY - spacing;
    const top = area.y + Math.floor((area.height - blockHeight) / 2);
    const slots = [];
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const inRow = Math.min(cols, count - row * cols);
        const rowWidth = inRow * pitchX - spacing;
        const left = area.x + Math.floor((area.width - rowWidth) / 2);

        slots.push({
            x: left + (i % cols) * pitchX,
            y: top + row * pitchY,
        });
    }

    return slots;
}

function cascadeSlots(area, cell, count) {
    // Restart from the first step once the next one would leave the area
    const room = Math.min(area.width - cell.width, area.height - cell.height);
    const perCycle = Math.max(1, Math.floor(room / CASCADE_STEP) + 1);
    const cycleLength = Math.min(count, perCycle);
    const span = (cycleLength - 1) * CASCADE_STEP;

    const left = area.x + Math.floor((area.width - cell.width - span) / 2);
    const top = area.y + Math.floor((area.height - cell.height - span) / 2);
    const slots = [];
    for (let i = 0; i < count; i++) {
        // Topmost windows get the front-most steps so titlebars stay visible
        const step = cycleLength - 1 - (i % cycleLength);

        slots.push({
            x: left + step * CASCADE_STEP,
            y: top + step * CASCADE_STEP,
        });
    }

    return slots;
}

function arrangeGroup(windows, w, h, arrangement, options) {
    if (arrangement === ARRANGE_STACK || windows.length === 1) {
        windows.forEach(win => placeWindow(win, w, h, options));
        return;
    }

    windows.forEach(prepareWindow);

    // Every window in the group shares one screen, so one area fits all
    const area = workspace.clientArea(KWin.MaximizeArea, windows[0]);
    const sizes = windows.map(win => presetSize(win, area, w, h, options.clamp));
    const cell = {
        width: Math.max.apply(null, sizes.map(s => s.width)),
        height: Math.max.apply(null, sizes.map(s => s.height)),
    };

    let slots = null;
    if (arrangement === ARRANGE_GRID) {
        slots = gridSlots(area, cell, windows.length, readGridSpacing());
    }
    if (!slots) {
        slots = cascadeSlots(area, cell, windows.length);
    }

    windows.forEach((win, i) => {
        // Center smaller windows in their slot so gaps stay even
        const x = slots[i].x + Math.floor((cell.width - sizes[i].width) / 2);
        const y = slots[i].y + Math.floor((cell.height - sizes[i].height) / 2);
        applyGeometry(win, area, x, y, sizes[i], options.clamp);
    });
}

function resizeAppWindows(win, w, h) {
    if (!win || win.deleted) return;

    const options = readPlacementOptions();
    const arrangement = readArrangement();
    const appWindows = collectAppWindows(win);
    if (!appWindows.length) return;

    const visible = [];
    appWindows.forEach(appWin => {
        // Minimized windows take no slot; they are placed as if resized alone
        if (appWin.minimized) {
            placeWindow(appWin, w, h, options);
        } else {
            visible.push(appWin);
        }
    });

    groupByOutput(visible).forEach(group => {
        arrangeGroup(group.windows, w, h, arrangement, options);
    });

    // The invoked window holds the front-most slot; make sure it is on top
    if (!win.minimized && typeof workspace.raiseWindow === "function") {
        workspace.raiseWindow(win);
    }
}

registerUserActionsMenu(function (win) {
    if (!win || win.deleted) return null;

    const presets = loadPresets();
    const items = presets.map(p => ({
        text: p.text,
        triggered: function () {
            resizeAndCenter(win, p.w, p.h);
        },
    }));

    // The count doubles as a quick check for other open windows of the app.
    // Trailing space keeps the submenu arrow clear of the text, as in "KSizer ".
    const appCount = collectAppWindows(win).length;
    if (appCount > 0) {
        items.push({
            text: "All windows of this app (" + appCount + ") ",
            items: presets.map(p => ({
                text: p.text,
                triggered: function () {
                    resizeAppWindows(win, p.w, p.h);
                },
            })),
        });
    }

    return {
        text: "KSizer ",
        items,
    };
});

// Named by position so user bindings survive label edits; no default keys
loadPresets().forEach((p, i) => {
    registerShortcut(
        "KSizer Preset " + (i + 1),
        "KSizer: Preset " + (i + 1) + " (" + p.text + ")",
        "",
        function () {
            resizeAndCenter(workspace.activeWindow, p.w, p.h);
        }
    );

    registerShortcut(
        "KSizer Preset " + (i + 1) + " All Windows",
        "KSizer: Preset " + (i + 1) + " (All windows) (" + p.text + ")",
        "",
        function () {
            resizeAppWindows(workspace.activeWindow, p.w, p.h);
        }
    );
});
