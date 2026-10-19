const CONFIG_KEY = "Presets";
const CONFIG_CLAMP_KEY = "ClampToArea";
const CONFIG_CENTER_KEY = "CenterWindow";
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
        label = trimmed.replace(sizeMatch[0], "").trim();
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


function resizeAndCenter(win, w, h) {
    if (!win || win.deleted) return;

    // Maximized or fullscreen windows ignore geometry changes
    if (win.fullScreen) win.fullScreen = false;
    if (win.maximizeMode) win.setMaximize(false, false);

    // MaximizeArea respects panels/docks
    const area = workspace.clientArea(KWin.MaximizeArea, win);
    const clampToArea = readConfig(CONFIG_CLAMP_KEY, true) === true;
    const centerWindow = readConfig(CONFIG_CENTER_KEY, true) === true;

    const width = clampToArea ? Math.min(w, area.width) : w;
    const height = clampToArea ? Math.min(h, area.height) : h;

    let x = win.frameGeometry.x;
    let y = win.frameGeometry.y;
    if (centerWindow) {
        x = area.x + Math.floor((area.width - width) / 2);
        y = area.y + Math.floor((area.height - height) / 2);
    }

    const maxX = area.x + area.width - width;
    const maxY = area.y + area.height - height;
    const finalX = clampToArea ? Math.min(Math.max(area.x, x), maxX) : x;
    const finalY = clampToArea ? Math.min(Math.max(area.y, y), maxY) : y;

    // On Plasma 6, frameGeometry is usually the right one to move+resize
    win.frameGeometry = { x: finalX, y: finalY, width, height };
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

    return {
        text: "KSizer ",
        items,
    };
});
