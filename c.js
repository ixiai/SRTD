/**
*   SRTD - SimRail Train Describer
*
*   A work-in-progress train describer for the popular Polish train simulation game,
*   made with love (and not enough time!...) by Angelo :-)
*
*/

var settings = {
    server: "en1",
    colour: "grn",
    drawScanLines: true,
    flipped: false,

    loggingSignalNames: false,
    recording: true,
    replaying: false
};
var selectedSetting = Object.keys(settings)[0];
var availableSettings = {
    server: [],
    colour: ["grn", "wht"],
    drawScanLines: [true, false],
    flipped: [false, true]
};

const coloursPalette = {
    "grn": ["#000", "#0F0"],
    "wht": ["#000", "#CCC"]
}

const serversListUrl = "https://panel.simrail.eu:8084/servers-open";
const constUrl = "https://panel.simrail.eu:8084/trains-open?serverCode=";

var coordinates = {};

var loggedSignalNames = {};
var recorded = [];

var cnv, ctx;

const textSize = 24;
const textSizeRatio = 2;
const textMargin = 1;

const charsPerRow = 160; // We could simulate ye olde 80 columns... but we won't!
const textLines = 120 / textSizeRatio; // For a proper 4 / 3 CRT monitor!
const screenRatio = charsPerRow / textSizeRatio / textLines; // Used to be fixed at 4 / 3, now it's N lines - way easier to deal with!
const screenWidth = charsPerRow * textSize / textSizeRatio * textMargin;
const screenHeight = screenWidth / screenRatio;

var area = "L001_KO_Zw";
var isCurrentlyFlipped = false;

addEventListener("load", start);

function start() {
    initSettings();
    initCoords();
    initCnv();
    initServersList();
    updateTrainDescriber();
    const interval = setInterval(function () {
        if (!settings.replaying) {
            updateTrainDescriber(true);
        }
    }, 5000);
}

function initSettings() {
    let href = window.location.href.split("#");
    if (href.length > 1) {
        let settingsString = href[1];
        let settingId = 0;
        for (let setting of settingsString.split("_")) {
            let settingName = Object.keys(settings)[settingId];
            let setTo = setting;
            if (settingId) {
                setTo = availableSettings[settingName][setTo];
            }
            settings[settingName] = setTo;
            settingId++;
            if (Object.keys(settings)[settingId] == undefined) {
                continue;
            }
        }
    }
    updateTrainDescriber();
}
addEventListener("hashchange", initSettings);

async function getDataFromServer(url = constUrl + settings.server) {
    // https://stackoverflow.com/questions/2499567/how-to-make-a-json-call-to-an-url/2499647#2499647
    const getJSON = async url => {
        const response = await fetch(url);
        return response.json();
    }
    let data;
    await getJSON(url).then(output => data = output);
    return (data);
}

function initCoords() {
    let logUndefinedSignals;
    for (let id in layouts) {
        logUndefinedSignals = [];
        coordinates[id] = {};
        for (let row in layouts[id]) {
            let signalsList = layouts[id][row].split("'");
            let signalId = 1;
            for (let char in layouts[id][row].split("'")[0]) {
                switch (layouts[id][row][char]) {
                    case "{":
                    case "}":
                        for (let signalName of ("" + signalsList[signalId]).split("%")) {
                            coordinates[id][signalName] = [layouts[id][row][char] == "}" ? char - 5 : char * 1, row * 1];
                            if (signalName != "§" && id != "Settings" && !allSignals.includes(signalName)) {
                                if (signalName == "undefined") {
                                    logUndefinedSignals.push([row, char]);
                                } else {
                                    console.warn("Signal " + signalName + " in layout " + id + " doesn't seem to exist in SimRail!");
                                }
                            }
                        }
                        signalId++;
                        break;
                }
            }
        }
        if (coordinates[id]["§"] != undefined) {
            delete coordinates[id]["§"];
        }
        if (logUndefinedSignals.length) {
            console.warn("Found undefined signals in layout %c" + id + "%c:", "color: blue", "color: black", logUndefinedSignals);
        }
        //if (coordinates[id].undefined != undefined) {
        //    console.warn("At least one signal is missing in layout " + id + "! The last one I found was @ ", coordinates[id].undefined)
        //}
    }
}

function initCnv() {
    cnv = document.getElementById("cnv");
    ctx = cnv.getContext("2d");

    cnv.style.position = "absolute";

    if (window.innerWidth >= window.innerHeight * screenRatio) { // Using a larger monitor
        cnv.style.height = window.innerHeight;
        cnv.style.width = window.innerHeight * screenRatio;
    } else { // Using a thinner monitor
        cnv.width = window.innerWidth;
        cnv.height = window.innerWidth / screenRatio;
    }

    ctx.width = screenWidth;
    ctx.height = screenHeight;

    cnv.width = screenWidth;
    cnv.height = screenHeight;

    document.body.style.overflow = 'hidden';
}

async function initServersList() {
    let servers = await getDataFromServer(serversListUrl);
    let serversList = [];
    for (let server of servers.data) {
        serversList.push(server.ServerCode);
    }
    availableSettings.server = serversList;
}

async function updateTrainDescriber(calledByTimer = false, data = undefined) {
    flipLayouts();
    if (data === undefined) {
        data = await getDataFromServer();
        data = polishData(data);
    }
    drawCanvas(data);

    if (settings.loggingSignalNames) {
        logSignalNames(data);
    }
    if (calledByTimer && settings.recording) {
        recordTrains(data);
    }
    drawVitalSymbol(calledByTimer);
}

function polishData(data) {
    data = findMissingSignals(data);
    for (let i in data.data) {
        delete data.data[i].EndStation;
        delete data.data[i].ServerCode;
        delete data.data[i].StartStation;
        delete data.data[i].TrainName;
        delete data.data[i].Type;
        delete data.data[i].Vehicles;
        delete data.data[i].id;
        delete data.data[i].TrainData.ControlledBySteamID;
    }
    return data;
}

function findMissingSignals(data) {
    if (!recorded.length) {
        return data;
    }
    for (let i in data.data) {
        if (data.data[i].TrainData.SignalInFront !== null) {
            continue;
        }
        let lastSeenAtSignal = null;
        let distanceFromLastSeenAtSignal = 0;
        for (let train of recorded[recorded.length - 1].data) {
            if (train.TrainNoLocal == data.data[i].TrainNoLocal) {
                if (train.TrainData.SignalInFront != null) {
                    lastSeenAtSignal = train.TrainData.SignalInFront;
                    distanceFromLastSeenAtSignal = train.TrainData.DistanceToSignalInFront;
                }
            }
        }
        if (lastSeenAtSignal === null) {
            continue;
        }
        if (lastSeenAtSignal.split("@")[1] == "-Infinity" || distanceFromLastSeenAtSignal > 500) {
            data.data[i].TrainData.SignalInFront = lastSeenAtSignal;
            if (distanceFromLastSeenAtSignal > 500) {
                console.log(lastSeenAtSignal);
                console.warn(
                    "Train %c" + data.data[i].TrainNoLocal + "%c lost track of signal %c" + lastSeenAtSignal.split("@")[0],
                    "color: blue", "", "color: blue"
                );
            }
        } else {
            for (let signal in missingSignals) {
                if (missingSignals[signal].includes(lastSeenAtSignal.split("@")[0])) {
                    data.data[i].TrainData.SignalInFront = signal + "@-Infinity";
                    console.log(
                        "Train %c" + data.data[i].TrainNoLocal + "%c passed signal %c" + lastSeenAtSignal.split("@")[0] + "%c; without further information, it's assumed to be heading towards signal %c" + signal,
                        "color: blue", "", "color: blue", "", "color: blue"
                    );
                    break;
                }
                // Just to avoid spamming the log with trains that went missing for a good reason:
                if (signalsLeadingToTheBackrooms.includes(lastSeenAtSignal.split("@")[0])) {
                    data.data[i].TrainData.SignalInFront = lastSeenAtSignal;
                }
            }
        }
    }
    let logTrainsWithNoSignal = "";
    for (let i in data.data) {
        if (data.data[i].TrainData.SignalInFront === null) {
            logTrainsWithNoSignal += data.data[i].TrainNoLocal + ", ";
        }
    }
    if (logTrainsWithNoSignal.length) {
        console.log("%cTrains not found: " + logTrainsWithNoSignal.slice(0, -2), "color: purple");
    }
    return data;
}

function recordTrains(data) {
    recorded.push(data);
}

async function replay() {
    let sleepSetTimeout_ctrl;
    function sleep(ms) {
        clearInterval(sleepSetTimeout_ctrl);
        return new Promise(resolve => sleepSetTimeout_ctrl = setTimeout(resolve, ms));
    }
    settings.replaying = true;
    for (let i in recorded) {
        updateTrainDescriber(false, recorded[i]);
        await sleep(200);
    }
    settings.replaying = false;
}

function drawCanvas(data) {
    ctx.font = "normal " + textSize + "px monospace";
    ctx.textBaseline = "top";

    ctx.fillStyle = coloursPalette[settings.colour][0];
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    ctx.fillStyle = coloursPalette[settings.colour][1];
    let text = layouts[area];
    for (let row in text) {
        for (let char in text[row].split("'")[0]) {
            ctx.fillText(text[row][char].replace("{", "─").replace("}", "─"), textSize * char / textSizeRatio * textMargin, textSize * row * textMargin);
        }
    }
    for (let row in menu) {
        for (let char in menu[row]) {
            ctx.fillText(menu[row][char], textSize * char / textSizeRatio * textMargin, textSize * (row * 1 + textLines - menu.length - 1) * textMargin);
        }
    }

    if (area == "Settings") {
        drawSettings();
    } else {
        let trainsToDraw = getTrainsCoords(data);
        drawTrains(trainsToDraw);
    }
    if (settings.drawScanLines) {
        drawScanLines();
    }
}

function getTrainsCoords(data) {
    let trainsToDraw = [];
    let distancesFromTrainsToSignals = [];

    for (let train of data.data) {
        if (train.TrainData.SignalInFront != null) {
            let nextSignal = train.TrainData.SignalInFront.split("@")[0];
            if (Object.keys(coordinates[area]).includes(nextSignal)) {
                trainsToDraw.push([
                    train.TrainNoLocal,
                    ...coordinates[area][nextSignal]
                ]);
                distancesFromTrainsToSignals.push({
                    signalName: train.TrainData.SignalInFront.split("@")[0],
                    distance: train.TrainData.DistanceToSignalInFront
                });
            }
        }
    }

    // Remove second train in same section
    // Btw, if the second train in the same section appears first, it's not removed - but it doesn't matter, since the other train, closer to the end of the section, will be drawn on top of it.
    let distancesFromSIGNALStoTRAINS = {};
    for (let i in distancesFromSIGNALStoTRAINS) {
        if (distancesFromSIGNALStoTRAINS[distancesFromSignalsToTrains[i].signalName] == undefined) {
            distancesFromSIGNALStoTRAINS[distancesFromSignalsToTrains[i].signalName] = distancesFromSignalsToTrains[i].distance;
        } else if (distancesFromSIGNALStoTRAINS[distancesFromSignalsToTrains[i].signalName] < distancesFromSignalsToTrains[i].distance) {
            trainsToDraw[i] = [null];
        }
    }

    let logSignalsWithMultipleTrains = [];
    for (let i in trainsToDraw) {
        if (trainsToDraw[i][0] === null) {
            logSignalsWithMultipleTrains.push(distancesFromSignalsToTrains[i].signalName);
        }
    }
    if (logSignalsWithMultipleTrains.length) {
        console.log("Some sections have more than one train on them: ", logSignalsWithMultipleTrains);
    }

    return trainsToDraw;
}

function logSignalNames(data) {
    for (let train of data.data) {
        if (train.TrainData.SignalInFront != null) {
            if (loggedSignalNames[train.TrainNoLocal] == undefined) {
                loggedSignalNames[train.TrainNoLocal] = [];
            }
            let nextSignal = train.TrainData.SignalInFront.split("@")[0];
            if (loggedSignalNames[train.TrainNoLocal][loggedSignalNames[train.TrainNoLocal].length - 1] != nextSignal) {
                loggedSignalNames[train.TrainNoLocal].push(nextSignal);
            }
        }
    }
}

async function debugNextSignal(trainNo) {
    const data = await getDataFromServer();
    for (let train of data.data) {
        if (train.TrainNoLocal == trainNo) {
            console.log(train.TrainData.SignalInFront.split("@")[0])
            return train.TrainData.SignalInFront.split("@")[0];
        }
    }
    return null;
}

function drawSettings() {
    function writeCoolSettingName(settingName, isSelected) {
        if (settingName === true) {
            settingName = "YES ";
        } else if (settingName === false) {
            settingName = "NO  ";
        }
        settingName = settingName.toUpperCase();
        settingName = settingName.substring(0, 4);
        for (let i = 4; i > settingName.length; i--) {
            settingName = settingName += " ";
        }
        settingName = (isSelected ? "◄ " : "  ") + settingName + (isSelected ? " ►" : "  ");
        return settingName;
    }
    for (let id of Object.keys(settings)) {
        if (coordinates.Settings[id] != undefined) {
            drawTrain(writeCoolSettingName(settings[id], id == selectedSetting), ...coordinates.Settings[id], id == selectedSetting, 8);
        }
    }
}

function drawTrains(trainsToDraw) {
    if (trainsToDraw.length) {
        for (let train of trainsToDraw) {
            drawTrain(...train);
        }
    }
}

function drawTrain(number = null, x, y, drawBoundingBox = true, maxLength = 6) {
    if (number === null) {
        return;
    }
    let n = number + "";
    ctx.fillStyle = drawBoundingBox ? coloursPalette[settings.colour][1] : coloursPalette[settings.colour][0];
    ctx.fillRect(x * textSize / textSizeRatio * textMargin, y * textSize * textMargin, textSize / textSizeRatio * textMargin * maxLength, textSize * textMargin);
    ctx.fillStyle = drawBoundingBox ? coloursPalette[settings.colour][0] : coloursPalette[settings.colour][1];
    for (let j = 2; j <= maxLength; j++) {
        if (n.length < j) {
            x++;
        }
    }
    for (let char in n) {
        ctx.fillText(n[char], textSize * (x + 1 * char) / textSizeRatio * textMargin, textSize * y * textMargin);
    }
}

const vitalSymbols = ["/", "-", "\\", "|"];
var vitalSymbolId = 0;
function drawVitalSymbol(updateVitalSymbol) {
    drawTrain(vitalSymbols[vitalSymbolId % 4], 0, textLines - 2, false, 1);
    if (updateVitalSymbol) {
        vitalSymbolId++;
    }
}

function drawScanLines() {
    const lineWidth = 2;
    ctx.strokeStyle = 'rgba(' + [0, 0, 0, 0.2] + ')';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let i = 0; i < screenHeight / lineWidth / 2; i++) {
        ctx.moveTo(0, i * lineWidth * 2);
        ctx.lineTo(screenWidth, i * lineWidth * 2);
    }
    ctx.stroke();
}

function resizeMonitor() {
    let cnv = document.getElementById("cnv");
    const clientScreenRatio = window.innerWidth / window.innerHeight;
    if (clientScreenRatio < screenRatio) { // Let's have black bars on top and bottom, for a cinematic look! ...on vertical screns, probably! Yaaaay!
        cnv.style.width = window.innerWidth + "px";
        cnv.style.height = window.innerWidth / screenRatio + "px";
    } else { // In this case, we'll have vertical black bars
        cnv.style.height = window.innerHeight + "px";
        cnv.style.width = window.innerHeight * screenRatio + "px";
    }
    cnv.style.left = (window.innerWidth - cnv.clientWidth) / 2 + "px"
}

function flipLayouts() {
    if (isCurrentlyFlipped == settings.flipped) {
        return;
    }
    isCurrentlyFlipped = settings.flipped;
    function replaceAt(text, index, replacement) {
        return text.substring(0, index) + replacement + text.substring(index + replacement.length);
    }
    for (let layoutId in layouts) {
        if (layoutId == "Settings") {
            continue;
        }
        layouts[layoutId] = layouts[layoutId].reverse();
        for (let i in layouts[layoutId]) {
            let signals = layouts[layoutId][i].split("'");
            let row = signals.shift();
            let flippedSignals = signals.reverse();
            let flippedRow = "";
            for (let i = row.length - 1; i >= 0; i--) {
                flippedRow += row[i];
            }
            flippedRow = flippedRow
                .replaceAll("{", "þ").replaceAll("}", "{").replaceAll("þ", "}")
                .replaceAll(">", "þ").replaceAll("<", ">").replaceAll("þ", "<")
                .replaceAll("├", "þ").replaceAll("┤", "├").replaceAll("þ", "┤")
                .replaceAll("┬", "þ").replaceAll("┴", "┬").replaceAll("þ", "┴")
                .replaceAll("┌", "þ").replaceAll("┘", "┌").replaceAll("þ", "┘")
                .replaceAll("└", "þ").replaceAll("┐", "└").replaceAll("þ", "┐");
            let regex = /^([a-zA-Z0-9\Ł\ł\_]+)$/;
            let currentlyOnAStringThatNeedsToBeReverseFlipped = false;
            let stringsThatNeedsToBeReverseFlippedStartsAtId = 0;
            let stringToBeReverseFlipped = "";
            for (let charId in flippedRow) {
                if (regex.test(flippedRow[charId]) && charId < flippedRow.length - 1) {
                    if (!currentlyOnAStringThatNeedsToBeReverseFlipped) {
                        currentlyOnAStringThatNeedsToBeReverseFlipped = true;
                        stringsThatNeedsToBeReverseFlippedStartsAtId = charId * 1;
                    }
                    stringToBeReverseFlipped += flippedRow[charId];
                } else if (currentlyOnAStringThatNeedsToBeReverseFlipped) {
                    currentlyOnAStringThatNeedsToBeReverseFlipped = false;
                    let flippedString = "";
                    for (let i = stringToBeReverseFlipped.length - 1; i >= 0; i--) {
                        flippedString += stringToBeReverseFlipped[i];
                    }
                    //console.log(stringToBeReverseFlipped, flippedString);
                    flippedRow = replaceAt(flippedRow, stringsThatNeedsToBeReverseFlippedStartsAtId, flippedString);
                    stringToBeReverseFlipped = "";
                }
            }
            for (let signal of flippedSignals) {
                flippedRow += "'" + signal;
            }
            layouts[layoutId][i] = flippedRow;
        }
    }
    initCoords();
    updateTrainDescriber();
}

document.addEventListener("DOMContentLoaded", resizeMonitor);
window.onresize = resizeMonitor;

function changeSetting(x) {
    if (area != "Settings") {
        return;
    }
    let index = availableSettings[selectedSetting].indexOf(settings[selectedSetting]);
    index += x;
    //console.log(availableSettings[selectedSetting], settings[selectedSetting]);
    if (index == availableSettings[selectedSetting].length) {
        index = 0;
    } else if (index < 0) {
        index = availableSettings[selectedSetting].length - 1;
    }
    //console.log(index);
    settings[selectedSetting] = availableSettings[selectedSetting][index];
    let href = "";
    for (let id in availableSettings) {
        if (id == "server") {
            href += "_" + settings[id];
        } else {
            href += "_" + availableSettings[id].indexOf(settings[id]);
        }
    }
    window.location.href = "#" + href.slice(1);
    updateTrainDescriber();
}

function changeSelectedSetting(x) {
    if (area != "Settings") {
        return;
    }
    let index = Object.keys(availableSettings).indexOf(selectedSetting);
    index += x;
    if (index == Object.keys(availableSettings).length) {
        index = 0;
    } else if (index < 0) {
        index = Object.keys(availableSettings).length - 1;
    }
    selectedSetting = Object.keys(availableSettings)[index];
    updateTrainDescriber();
}

function keyboard(e) {
    //console.log("Key detected: " + e.key);
    let setAreaTo = area;
    switch (e.key.toLowerCase()) {
        case "1":
            setAreaTo = "L001_KO_Zw";
            break;
        case "2":
            setAreaTo = "L004_Zw_Gr";
            break;
        case "3":
            setAreaTo = "L062_SG_Tl";
            break;
        case "s":
            setAreaTo = "Settings";
            break;
        case "arrowleft":
            changeSetting(-1);
            break;
        case "arrowright":
            changeSetting(1);
            break;
        case "arrowup":
            changeSelectedSetting(-1);
            break;
        case "arrowdown":
            changeSelectedSetting(1);
            break;
    }
    if (area != setAreaTo) {
        updateTrainDescriber();
        area = setAreaTo;
    }
}

document.addEventListener("keydown", keyboard);


// If a train is at >5km from the next signal, we receive no information.
// However, since we know what the last signal was, we can at least make an educated guess... sometimes.
// Relying on both this and coordinates would be way better.
// Even better, if we could read the next signal backwards, we'd easily know on which track we are.
// At any rate, there's still plenty of room for improvement, here. But this is a łazy solution that should work most of the time... for now.
// Will come back and improve it, one day or another.
// Because now I made it in a BAD way.
// Anyways... for example, if your last signal was Sp_B, perhaps now you're headed towards Str_B
const missingSignals = {
    "Str_B": ["Sp_B"],
    "Kz_C": ["Sp_D"],
    "Sp_D": ["Str_C", "Str_D"],
    "Tl_N": ["Ch_D", "Ch_C", "Ch_K", "Ch_B"],
    "Ch_A": ["Tl_H", "Tl_J", "Tl_G", "Tl_F"],
    "Ch1_H": ["GA_D"],
    "GA_D": ["W1_C", "W1_D", "W1_E"],
    "Ga_B": ["Ch1_E", "Ch1_F", "Ch1_G"],
    "W1_A": ["Ga_B"],
    "W_K": ["Za_D"],
    "Za_D": ["JO1_B", "JO1_C", "JO1_D"],
    "Za_B": ["W_S", "W_E", "W_G", "W_H", "W_J"],
    "JO1_A": ["Za_B"],
    "O_A": ["JO_G", "JO_F", "JO_E"],
    "JO_H": ["O_C", "O_D", "O_B3"],
    "O1_H": ["Bo_D11", "Bo_D9", "Bo_D7", "Bo_D5", "Bo_D3", "Bo_D1", "Bo_D2", "Bo_D4", "Bo_D6", "Bo_D8"],
    "Bo_B": ["O1_E", "O1_F", "O1_G"],
    "Bo_L": ["Sl_E3", "Sl_E1", "Sl_E2", "Sl_E4", "Sl_E6"],
    "Sl_C": ["Bo_F11", "Bo_F9", "Bo_F7", "Bo_F5", "Bo_F3", "Bo_F1", "Bo_F2", "Bo_F4", "Bo_F6", "Bo_F8"],
    "DW_T": ["Sl_H3", "Sl_H1", "Sl_H2", "Sl_H4"],
    "Gn_A": ["Sd3_J1", "Sd3_H3", "Sd3_H7", "Sd3_H9", "Sd3_H11", "Sd3_H4"]
};

const signalsLeadingToTheBackrooms = ["Cz_Z", "fake3", "fake12", "l137_ktc_u1", "l137_ktc_u2", "Mi_L", "My_C", "sma_O", "Ssc_B", "Ssc_D", "Zes_A", "Zy_B"];

const allSignals = [
    "Za_C", "Za_D", "Za_A", "Za_B", "L572_41", "L572_41N", "L572_59", "L572_59N", "Zes_B", "Zes_A", "GA_D", "Ga_B", "GA_C", "Ga_A", "SMA_B", "SMA_B2", "SMA_C", "l139_bry_J", "l139_bry_H", "l139_bry_c", "l139_bry_e", "l139_bry_a", "l139_bry_b", "l139_bry_d", "Ssc_E", "Ssc_B", "l137_16n", "l137_22", "l137_17", "l137_21n", "l139_15", "l139_20", "Ssc_D", "KMB_P", "KMB_O", "KMB_N", "KMB_Y25", "KMB_Y21", "KMB_Y23", "KO_O", "KO_P", "KO_Tm70", "KO_Tm67", "KO_Tm72", "KO_Tm69", "KO_T", "KO_W61", "KO_W62", "KO_R", "KO_S", "KO_Tm68", "KO_Tm71", "KO_W63", "KO_Tm130", "KMB_M", "KMB_L", "KO_N3", "KO_N2", "KO_N8", "KO_Tm65", "KO_Tm60", "KO_N6", "KO_N4", "KO_Tm61", "KO_N1", "KO_Tm63", "KO_Tm54", "KO_N7", "KO_N9", "KO_Tm52", "KO_Tm55", "KO_N10", "KO_Tm53", "KO_Tm51", "KO_N5", "KO_Tm58", "KO_Tm56", "KO_Tm101", "KO_Tm62", "KO_Tm66", "KO_Tm64", "KO_X41", "KO_X42", "KO_Tm40", "KO_Tm29", "KO_Tm41", "KO_Tm18", "KO_Tm44", "KO_Tm45", "KO_Tm21", "KO_Tm39", "KO_Tm46", "KO_Tm47", "KO_Tm30", "KO_Tm22", "KO_Tm23", "KO_Tm24", "KO_Tm25", "KO_Tm17", "KO_Tm28", "KO_F", "KO_Tm42", "KO_Tm43", "KO_Tm26", "KO_Tm32", "KO_Tm34", "KO_Tm35", "KO_Tm33", "KO_Tm36", "KO_M8", "KO_M10", "KO_M6", "KO_M2", "KO_M1", "KO_Tm31", "KO_M4", "KO_Tm37", "KO_M7", "KO_M9", "KO_M5", "KO_M3", "KO_Tm7", "KO_Tm5", "KO_Tm15", "KO_Tm9", "KO_Tm14", "KO_E14", "KO_L", "KO_Tm19", "KO_E13", "KO_K", "KO_E15", "KO_J", "KO_Tm10", "KO_G14", "KO_E16", "KO_G16", "KO_G18", "KO_Tm13", "KO_E18", "KO_E20", "KO_Tm16", "StA_Tm2", "StA_Tm10", "StA_H", "StA_G", "StA_Tm5", "StA_A", "StA_K", "StA_F", "StA_L", "StA_E", "StA_D", "StA_J", "StA_Tm1", "StA_C", "KO_Tm502", "KO_Tm501", "KO_Tm6", "KO_Tm1", "KO_Tm2", "KO_Tm4", "KO_Tm3", "KO_D", "KO_C", "KO_A", "KO_B", "StA_M108", "StA_Tm6", "StA_Tm7", "StA_Tm8", "StA_Tm3", "StA_Tm9", "StA_Tm4", "StB_N6", "StB_N4", "KO_Tm507", "KO_Tm508", "KO_503", "KO_Tm516", "KO_Tm515", "KO_Tm517", "KO_Tm518", "KO_Tm519", "KO_Tm520", "KO_Tm521", "KO_Tm509", "KO_Tm514", "KO_Tm513", "KO_Tm512", "KO_Tm511", "KO_Tm510", "KO_Tm506", "KO_Tm505", "KO_Tm504", "StB_Tm17", "StB_Tm25", "StB_Tm15", "StB_N3", "StB_N1", "StB_N5", "StB_Tm26", "StB_N2", "StB_Tm21", "StB_Tm19", "StB_Tm20", "StB_P", "StB_R", "StB_Tm16", "StB_S", "StB_Tm18", "KZ_Tm9", "KZ_Tm10", "KZ_Tm11", "KZ_J1S", "KZ_O", "KZ_P1M", "KZ_P", "KZ_M", "KZ_K", "KZ_K2", "KZ_N6", "KZ_M4", "KZ_N8", "KZ_N10", "Pł_Tm30", "KZ_F", "KZ_G", "KZ_H", "KZ_D1", "KZ_D2", "KZ_Tm2", "KZ_E", "KZ_E3", "Pł_Tm29", "Pł_Tm11", "Pł_T5", "Pł_Tm28", "Pł_T8", "Pł_T7", "Pł_T6", "Pł_Tm18", "Pł_Tm10", "Pł_Tm16", "KJw_x_Z", "KZ_B2", "KZ_A", "KZ_J2", "KZ_B1", "KZ_J", "Pł_Tm4", "KJw_M", "KJw_Z", "KJw_C", "KJw_D", "KJw_K", "KJw_L", "KJw_N", "KJw_H", "KJw_A", "L1_3138", "KJw_W", "Lg_T21", "Lg_Tm2", "Lg_T22", "L138_282", "L1_3133", "L1_3133N", "L138_279", "L138_279N", "L138_282N", "L1_3128N", "L1_3128", "Sk_E", "Sk_M", "Szb_D", "Sk_L", "Sk_K", "Sk_X", "Sk_D", "Sk1_G", "Sk1_C", "Sk1_O", "Szb_D1", "Szb_C1", "L138_266", "L138_266N", "Sk1_A", "L1_3121", "L1_3121N", "Sk1_B", "Szb_A", "SG_X", "SG_Y", "SG_U1", "SG_U2", "SG_S", "MW_U", "MW_W", "MW_Z", "Spł1_J", "SPł1_L", "SPl1_N", "SPł1_M", "SPł1_K", "SPł1_T", "SPł1_W", "SG_P", "SG_N5", "SG_R2", "SG_Tm35", "SG_N4", "SG_N7", "SG_N11", "SG_N13", "SG_N9", "SG_Tm30", "SG_N1", "SG_N2", "SG_Tm32", "SG_N3", "SG_Tm34", "SG_Tm39", "SG_R1", "SPł1_B", "SPł1_C", "SPł1_D", "SPł1_E", "SG_Tm25", "SG_Tm24", "SG_Tm23", "SG_Tm22", "SG_H3", "SG_H5", "SG_H7", "SG_H9", "SG_Tm21", "SPł1_A", "SG_H2", "SG_Tm8", "SG_Tm7", "SG_Tm11", "SG_H4", "SG_Tm10", "SG_H1", "SG_Tm12", "SG_Tm19", "SG_Tm1", "SG_Tm2", "SG_Tm3", "B_Tm18", "B_E4", "B_E2", "B_B", "B_C", "B_Tm7", "B_Tm6", "B_A", "B_D", "L1_3036N", "L1_3037", "L1_3037N", "L1_3036", "SG_A", "SG_C", "SG_Tm4", "SG_B", "L1_3075N", "L1_3076", "L1_3071", "L1_3070N", "B_P", "B_Tm40", "B_R", "B_S", "B_Tm24", "B_K10", "B_Tm21", "B_Tm25", "B_K8", "B_Tm39", "B_Tm38", "B_Tm28", "B_K2", "B_Tm29", "B_Tm33", "B_Tm41", "B_K1", "B_K4", "B_K6", "B_Tm12", "B_Tm14", "B_Tm16", "B_Tm15", "B_Tm23", "B_Tm22", "B_Tm13", "B_E8", "B_E10", "B_E6", "B_E1", "SDn_Z", "L1_3022", "L1_3022N", "L1_3023N", "L1_3023", "SDn_Sz1N", "SDn_Tm4", "SDn_W", "SDn_Tm6", "SDn_R", "SDn_U", "SDn_S", "SDn_Tm3", "SDn_P", "SDn_T", "SDn_N", "SDn_O", "DG_P", "DG_O_12", "SDN1_F", "SDn1_D", "SDn1_J", "SDn1_M", "SDn1_G", "SDn1_K", "SDn1_H", "SDn1_E", "SDn1_L", "DG_D", "DG_N2", "DG_Tm7", "DG_Tm8", "DG_N1", "DG_N102", "DG_N104", "SDn1_Tm1", "SDn1_Tm2", "SDn_C", "SDn_B", "SDn_A", "DG_C1", "DG_C2", "DG_C102", "DG_C104_2m", "DG_Tm2", "DG_Tm1", "DG_A", "DG_B", "L1_2983N", "L1_2980", "L1_2983", "Ju_G", "Ju_H", "L1_2980N", "KJ1_Tm11", "SKz_S", "SKz_Tm23", "SKz_N", "SKz_Tm22", "L1_2971", "L1_2971N", "Ju_C", "Ju_Tm1", "SKz_Tm21", "SKz_M", "SKz_R", "SKz_O", "SKz_L", "SKz_Tm12", "SKz_Tm11", "SKz_K", "SKz_J", "SKz_C", "SKz_F", "SKz_H", "SKz_E", "SKz_G", "L1_2966", "L1_2966N", "Ju_A", "Ju_B", "SKz_T", "SKz_Tm14", "SKz_Tm1", "SKz_Tm2", "SKz_A", "L1_2955", "L1_2955N", "L1_2952N", "L1_2952", "DS_Z", "DS_W", "DS_Tm15", "DS_Tm15a", "DGHK_N", "DGHK_Tm2", "DGHK_Tm1", "DGHK_Tm3", "DGHK_Tm5", "DGHK_Tm4", "DGHK_S", "DGHK_R", "DGHK_T", "DGHK_H", "DGHK_G", "DZ_Z", "DZ_Tm43", "DZ_Y", "DZ_Tm54", "DZ_Tm53", "DZ_Tm51", "DZ_Tm42", "DZ_Tm35", "L1_2941", "DZ_U201", "DZ_U202", "DZ_U203", "DZ_U204", "DZ_U103", "DZ_U105", "DZ_U101", "DZ_U102", "DZ_Tm36", "DZ_S101", "DZ_S102", "DZ_S103", "DZ_Tm32", "DZ_S105", "DZ_S104", "DZ_Tm45", "DZ_Tm33", "DZ_Tm28", "DZ_X2N", "DZ_X", "DZ_W", "DZ_S204", "DZ_S203", "DZ_S202", "DZ_S201", "DZ_Tm27", "DZ_V", "DS_Q", "DS_T", "DS_V", "DS_S", "DS_U", "DS_P14", "DS_P", "DS_Tm11", "DS_Y", "DGHK_L", "DGHK_M", "DZ_P", "DZ_N6", "DZ_N4", "DZ_O", "DZ_J", "DZ_M", "DZ_Tm21", "DZ_Tm18", "DZ_Tm12", "DZ_Tm11", "DZ_L1", "DZ_G11", "DZ_G13", "DZ_F", "DZ_G15", "DZ_G9", "DZ_Tm13", "DZ_G17", "DZ_K", "DS_K", "DS_L", "DS_Tm5", "DS_Tm4", "DS_C", "DS_E", "DS_F", "DS_G", "DS_J", "DS_H", "DS_D", "DZ_Tm8", "DZ_Tm9", "DZ_Tm2", "DZ_C12", "DZ_D", "DZ_C10", "DZ_Tm7", "DZ_C17", "DZ_Tm6", "DZ_C13", "DZ_C15", "DZ_Tm5", "DZ_Tm4", "DZ_Tm10", "DZ_Tm3", "DZ_B", "DZ_Tm1", "DZ_H", "DZ_E2", "DZ_A", "Dra_A", "Dra_E", "Dra_B", "Dra_C", "Dra_D", "Dra_M", "Dra_L", "DS_B", "DS_A", "Dra_K", "Dra_J", "DP1_M", "DP1_K", "DP1_J", "DP1_H", "DP1_H3", "DP1_G", "DP1_Tm3", "DP1_Tm2", "DP_B3", "DP_B1", "DP_D", "DP_C", "DP_Tm1", "DP_L", "DP_A", "L186_2900", "L186_2900N", "L160_2899", "L160_2899N", "L1_2900D", "L1_2900DN", "L1_2899DN", "L1_2899D", "DW_D", "DW_Tm1", "DW_Tm2", "DW_A", "DW_B", "DW_C", "DW_G", "DW_Tm8", "DW_Tm7", "DW_Tm9", "DW_Tm10", "DW_Tm11", "DW_J", "DW_H", "DW_Tm6", "DW_K10", "DW_K8", "DW_F", "DW_Tm5", "DW_Tm4", "DW_Tm25", "DW_Tm22", "DW_Tm21", "DW_M8", "DW_O", "DW_Tm23", "DW_N", "DW_M10", "L186_2886", "L186_2886N", "L160_2885N", "L160_2885", "L1_2886D", "L1_2886DN", "L1_2885DN", "L1_2885D", "DW_Tm29", "DW_Tm30", "DW_Tm28", "DW_Tm27", "DW_Tm26", "DW_Tm31", "DW_P", "DW_R", "DW_Tm32", "DW_T", "DW_U", "DW_X", "DW_W", "L186_2870", "L160_2869N", "L186_2869N", "L160_2869", "L1_2869DN", "L1_2868D", "L1_2869D", "L1_2868DN", "L1_2852", "L1_2854N", "L1_2851N", "L1_2851", "L160_2854", "L160_2853", "L186_2852", "L186_2851", "LC_Z", "LC_Y", "LC_Tm645", "LC_U", "LC_T", "LC_W2", "LC_W1", "Sl_J", "Sl_K", "LC_Tm642", "LC_S7", "LC_Tm621", "LC_Tm622", "LC_Tm616", "L1_2638N", "L1_2637N", "L1_2637", "L1_2638", "Sl_H1", "Sl_Tm13", "LC_S6", "LC_S3", "LC_Tm614", "LC_S613", "LC_S607", "LC_S605", "LC_S611", "LC_S609", "LC_Tm613", "LC_Tm611", "LC_Tm612", "LC_S617", "LC_S615", "LC_S1", "LC_S2", "LC_S4", "L1_2650", "L1_2650N", "Sl_E2", "Sl_Tm11", "Sl_E1", "Sl_Tm4", "Sl_E3", "Sl_Tm10", "Sl_Tm7", "Sl_Tm5", "Sl_Tm33", "Sl_Tm6", "Sl_E6", "Sl_Tm8", "Sl_Tm9", "Sl_E4", "Sl_H6", "Sl_H4", "Sl_H2", "Sl_H3", "L1_2665N", "L4_2162", "L4_2162N", "L1_2665", "L4_2161N", "L4_2161", "L1_2662N", "L1_2661", "L1_2651N", "L1_2651", "L4_2141N", "L4_2141", "L4_2142", "L4_2142N", "Sl_C", "Sl_B", "Sl_Tm1", "Sl_Tm32", "LB_P1", "LB_P2", "LB_P3", "LB_M6", "LB_M4", "L4_2182", "L4_2182N", "L4_2183N", "L4_2183", "L1_2676", "L1_2676N", "L1_2677N", "L1_2677", "LB_H2", "LB_R3", "LB_N", "LB_H3", "LB_Tm376", "LB_Tm351", "LB_Tm346", "LB_P7", "LB_Tm356", "LB_Tm373", "LB_Tm431", "LB_Tm402", "LB_Tm355", "LB_Tm414", "LB_Tm403", "LB_L", "LB_Tm413", "LB_Tm412", "LB_Tm411", "LB_Tm401", "LB_J125", "LB_J123", "LB_Tm416", "LB_Tm415", "LB_H1", "LB_Tm417", "L1_2693N", "L1_2692", "L1_2963", "L1_2692N", "L4_2128", "L4_2128N", "LB_R2", "LB_R1", "LB_O", "LB_Tm345", "LB_Tm347", "LB_Tm312", "LB_Tm332", "LB_Tm341", "LB_Tm331", "LB_Tm342", "LB_Tm323", "LB_Tm321", "LB_Tm333", "LB_Tm322", "LB_Tm310", "LB_Tm311", "LB_Tm302", "LB_Tm304", "LB_Tm303", "LB_Tm309", "LB_Tm308", "LB_Tm307", "LB_Tm306", "LB_Tm305", "LB_Tm301", "LB_Q123", "LB_Q125", "LB_H312", "L4_2199N", "L4_2199", "L4_2119N", "L4_2119", "LB_H314", "LB_Tm212", "LB_H308", "LB_H322", "LB_H316", "LB_H318", "LB_H320", "LB_Tm205", "LB_Tm203", "LB_Tm213", "LB_Tr1", "LB_Tm209", "LB_Tm211", "LB_Tm210", "LB_Tm206", "LB_G2", "LB_G1", "LB_H306", "LB_H310", "LA_Tm38", "LA_Tm40", "LB_Tm202", "LB_Tm200", "LB_Tm201", "LA_Tm154", "LA_Tm39", "LA_Tm37", "LA_F119", "L1_2790", "L1_2791", "L4_2206", "L4_2206N", "L1_2706", "L1_2706N", "L1_2707N", "L1_2707", "L4_2114", "L4_2114N", "LA_Tm36", "LA_Tm153", "LA_Tm152", "LA_Tm151", "LA_Tm147", "LA_Tm142", "LA_Tm149", "LA_F113", "LA_F111", "LA_Tm145", "LA_H324", "L1_2781", "L1_2780N", "LA_Tm126", "LA_Tm132", "LA_Tm133", "LA_F109", "LA_F115", "LA_F105", "LA_F103", "LA_F117", "LA_F107", "LA_F108", "LA_Tm125", "LA_F106", "LA_F110", "LA_Tm120", "LA_Tm119", "LA_Tm143", "LA_Tm131", "LA_Tm123", "LA_Tm124", "LA_Tm122", "LA_Tm121", "LA_Tm112", "LA_Tm111", "LA_Tm113", "LA_Tm114", "LA_Tm115", "LA_Tm118", "LA_Tm117", "LA_Tm116", "LA_Tm137", "LA_Tm141", "LA_Tm109", "LA_Tm136", "LA_F4", "Zw_Tm72", "Zw_U", "Zw_T25", "Zw_T23", "L1_2718", "L1_2718N", "L1_2719N", "L1_2719", "L4_2213N", "L1_2213", "L4_2103N", "L4_2103", "LA_E1", "LA_E2", "LA_E4", "LA_Tm19", "LA_Tm18", "LA_E116", "LA_E106", "LA_Tm22", "LA_Tm31", "LA_Tm30", "LA_Tm23", "LA_Tm27", "LA_Tm24", "LA_Tm25", "LA_Tm26", "LA_E120", "LA_E110", "LA_E108", "LA_E112", "LA_E114", "LA_E122", "LA_Tm496", "LA_Tm34", "LA_Tm33", "LA_Tm32", "LA_E136", "LA_E134", "LA_Tm497", "LA_E118", "LA_Tm495", "LA_Tm21", "LA_Tm29", "LA_Tm28", "LA_Tm15", "LA_Tm7", "LA_Tm8", "LA_Tm12", "LA_Tm9", "LA_E130", "LA_E126", "LA_E132", "LA_E128", "LA_E138", "LA_E124", "Zw_T21", "Zw_A", "Zw_B", "Zw_D", "Zw_C", "L1_2728", "L1_2729N", "L4_2100", "L4_2100N", "LA_C1", "LA_C2", "LA_B", "LA_D3", "LA_Tm3", "LA_Tm2", "Zw_R", "Zw_Tm61", "Zw_P4", "Zw_Tm60", "Zw_P116", "Zw_P118", "Zw_P120", "Zw_Tm62", "Zw_P104", "Zw_P114", "Zw_W", "Zw_Tm63", "Zw_S3", "Zw_Tm81", "Zw_P106", "Zw_P108", "Zw_P110", "Zw_S23", "Zw_S25", "Zw_P112", "Zw_N", "Zw_M", "Zw_Tm50", "Zw_O4", "Zw_Tm47", "Zw_Tm59", "Zw_O106", "Zw_O112", "Zw_O104", "Zw_Tm48", "Zw_O114", "Zw_O108", "Zw_O110", "Zw_O116", "Zw_O118", "Zw_O120", "Zw_Tm51", "Zw_Tm49", "Zw_L", "Zw_Tm43", "Zw_Tm42", "Zw_Tm45", "Zw_H3", "Zw_Tm44", "Zw_H5", "Zw_Tm26", "Zw_Tm28", "Zw_Tm27", "Zw_K", "Zw_Tm54", "Zw_Tm55", "Zw_H4", "Zw_Tm32", "Zw_G1", "Zw_G2", "Zw_Tm31", "Zw_Tm33", "Zw_Tm34", "Zw_H7", "Zw_Tm25", "Zw_Tm22", "Zw_Tm24", "Zw_Tm23", "Zw_Tm21", "Zw_H13", "Zw_H15", "Zw_E4", "Zw_E3", "Zw_E1", "Zw_Tm18", "Zw_E2", "Zw_Tm16", "Zw_Tm17", "Zw_Tm19", "Zw_E7", "Zw_E5", "Zw_E13", "Zw_Tm15", "Zw_E15", "Zw_Tm11", "Zw_Tm10", "Zw_Tm7", "Zw_Tm6", "Zw_Tm3", "Zw_Tm2", "Zw_Tm5", "Zw_Tm4", "Zw_Tm9", "Zw_Tm8", "Zw_Tm1", "L4_2086", "L4_2086N", "L4_2085N", "L4_2085", "Bo_O", "Bo_P", "Bo_L", "Bo_Tm64", "Bo_Tm63", "Bo_K", "Bo_T", "Bo_R", "Bo_S", "Bo_Tm61", "Bo_F2", "Bo_F4", "Bo_Tm42", "Bo_F5", "Bo_Tm62", "Bo_Tm47", "Bo_Tm56", "Bo_Tm54", "Bo_Tm48", "Bo_F8", "Bo_F6", "Bo_Tm41", "Bo_F1", "Bo_Tm52", "Bo_Tm53", "Bo_Tm57", "Bo_Tm51", "Bo_Tm55", "GW_W", "GW_T", "Bo_F3", "Bo_F11", "Bo_Tm34", "Bo_Tm31", "Bo_Tm21", "Bo_Tm23", "Bo_Tm33", "Bo_F9", "Bo_H", "Bo_J", "Bo_F7", "GW_Tm13", "GW_N", "GW_Tm11", "GW_L", "GW_Tm12", "GW_M", "Bo_D1", "Bo_D4", "Bo_D2", "Bo_Tm13", "Bo_D11", "Bo_D3", "Bo_Tm1", "Bo_Tm10", "Bo_Tm15", "Bo_D7", "Bo_Tm9", "Bo_D5", "Bo_D8", "Bo_Tm8", "Bo_D6", "Bo_Tm24", "Bo_Tm7", "Bo_Tm11", "Bo_Tm14", "Bo_Tm16", "Bo_D9", "GW_O", "Bo_Tm101", "Bo_Tm102", "Bo_A", "Bo_B", "Bo_Tm2", "Bo_G", "GW_G", "GW_E", "GW_F", "GW_H", "GW_Tm2", "GW_Tm1", "GW_B", "GW_A", "L4_2035N", "L4_2035", "L4_2036N", "L4_2036", "L4_2023N", "L4_2023", "L4_2022N", "L4_2022", "L4_2009N", "L4_2009", "L4_2008N", "L4_2008", "L4_1995N", "L4_1995", "L4_1994N", "L4_1994", "O1_SzN1", "O1_H", "O1_G", "O1_F", "O1_E", "O_D", "O_B", "O_C", "O_B3", "L4_1981N", "L4_1981", "L4_1980", "L4_1980N", "O_A", "O_SzN2", "L4_1967N", "L4_1967", "L4_1966N", "L4_1966", "JO_M", "JO_G", "JO_SzN1", "JO_H", "JO_F", "JO_E", "L4_1951N", "L4_1951", "L4_1950", "L4_1950N", "JO1_D", "LHS2_L", "JO1_C", "JO1_B", "JO1_SzN2", "JO1_A", "L4_1935N", "L4_1935", "L4_1936N", "L4_1936", "L4_1917N", "L4_1917", "L4_1918", "L4_1918N", "LHS1_N", "LHS1_Tm1", "LHS1_L", "LHS1_K", "LHS1_J", "LHS1_D", "LHS1_E", "LHS1_F", "LHS1_A", "L4_1897N", "L4_1898", "L4_1897", "L4_1898N", "L62_264N (1)", "L4_1881N", "L4_1881", "L4_1882N", "L4_1882", "L4_1828", "L4_1828N", "L4_1827N", "L4_1827", "L4_1807N", "L4_1807", "L4_1806N", "L4_1806", "L4_1789N", "L4_1789", "L4_1788N", "L4_1788", "L62_368", "L4_1859N", "L4_1859", "L4_1858N", "L4_1858", "L4_1841N", "L4_1841", "L4_1842N", "L4_1842", "L4_1773N", "L4_1773", "L4_1774", "L4_1774N", "L4_1759N", "L4_1759", "L4_1758N", "L4_1758", "W_Sz1N", "W_K", "L4_1743N", "L4_1743", "L4_1742", "W_F", "W_H", "W_J", "W_G", "L4_1742N", "W1_E", "W1_B", "W1_C", "W1_D", "W1_A", "W1_Sz2N", "L4_1727N", "L4_1727", "L4_1726N", "L4_1726", "Str_C", "Str_D", "L570_15N", "L570_15", "Str_A", "Str_B", "Ps_T", "Ps_V", "Ps_W", "Ps_Tm19", "Ps_Tm16", "Ps_Tm12", "Ps_Tm13", "Ps_Tm18", "Ps_Tm20", "Ps_Tm11", "Ps_O", "Ps_L", "Ps_K", "Ps_N", "Ps_M", "Ps_J", "Ps_H", "Ps_E", "Ps_F", "Ps_Tm4", "Ps_G", "Ps_Tm2", "Ps_Tm1", "Ps_B", "Ps_A", "L4_1673N", "L4_1673", "L4_1674N", "L4_1674", "OP_B", "OP_A", "L4_901N", "L4_901", "L4_900N", "L4_900", "L4_885N", "L4_885", "L4_886", "L4_886N", "L4_869N", "L4_869", "L4_868", "L4_868N", "L4_855", "L4_854", "L4_854N", "L4_855N", "L4_840N", "L4_839N", "L4_840", "L4_839", "Id_Tm63", "Id_Tm55", "Id_Tm59", "Id_Tm60", "Id_Tm58", "Id_Tm75", "Id_Tm76", "Id_Tm73", "Id_Tm71", "Id_Tm74", "Id_Tm72", "Id_Tm57", "Id_Tm62", "Id_Tm61", "Id_Tm56", "Id_W", "Id_Z", "Id_Tm54", "Id_P", "Id_O", "Id_N6", "Id_N14", "Id_N12", "Id_N10", "Id_Tm49", "Id_R", "Id_S", "Id_Tm53", "Id_T5", "Id_T7", "Id_T9", "Id_Tm50", "Id_N8", "Id_Tm52", "Id_Tm51", "Id_Tm33", "Id_K", "Id_M6", "Id_Tm34", "Id_Tm23", "Id_Tm21", "Id_M12", "Id_M14", "Id_M8", "Id_M10", "Id_H", "Id_G", "Id_Tm26", "Id_F7", "Id_J", "Id_F9", "Id_Tm36", "Id_L", "Id_Tm22", "Id_Tm31", "Id_Tm35", "Id_Tm37", "Id_Tm9", "Id_C", "Id_B", "Id_Tm24", "Id_Tm14", "Id_Tm13", "Id_Tm15", "Id_Tm12", "Id_Tm16", "Id_Tm11", "Id_Tm3", "Id_Tm1", "Id_A", "Id_Tm8", "Id_Tm7", "Id_E", "L4_785N", "L4_784N", "L4_784", "L574_27", "L574_27N", "L573_21", "L573_21N", "L4_785", "L573_33", "L573_33N", "L574_15N", "L574_15", "L4_766N", "L4_766", "L4_765N", "L4_765", "Rd_M", "Rd_N", "L4_751", "L4_751N", "L4_750", "L4_750N", "L4_731N", "L4_731", "L4_732", "L4_732N", "L4_711N", "L4_711", "L4_712", "L4_712N", "L4_691N", "L4_691", "L4_692", "L4_692N", "L4_667N", "L4_667", "L4_668N", "L4_668", "L4_653N", "L4_653", "L4_654N", "L4_654", "L4_634", "L4_634N", "L4_633", "L4_633N", "L4_611N", "L4_611", "L4_610", "L4_610N", "L4_595N", "L4_595", "L4_596", "L4_596N", "St_W", "St_Z", "St_Tm12", "St_Tm13", "St_Tm14", "St_O", "St_N", "St_P", "St_Tm11", "St_M", "St_J", "St_F", "St_G", "St_H", "St_Tm2", "St_Tm1", "St_A", "St_B", "L4_543N", "L4_543", "L4_544", "L4_544N", "L4_529N", "L4_529", "L4_530", "L4_530N", "L4_515N", "L4_515", "L4_516", "L4_516N", "L4_499N", "L4_500", "L4_499", "L4_500N", "L4_477N", "L4_477", "L4_476", "L4_476N", "L4_455N", "L4_455", "L4_456", "L4_456N", "L4_439N", "L4_439", "L4_438", "L4_438N", "L4_421N", "L4_421", "L4_422", "L4_422N", "BR_C", "BR_D", "BR_B", "BR_A", "L4_383N", "L4_383", "L4_384", "L4_384N", "L4_361N", "L4_361", "L4_360", "L4_360N", "L4_345N", "L4_345", "L4_346", "L4_346N", "L4_331N", "L4_331", "L4_332", "L4_332N", "L4_307N", "L4_307", "L4_308", "L4_308N", "L4_291N", "L4_291", "L4_292", "L4_292N", "L4_277N", "L4_277", "L4_276", "L4_276N", "L4_261N", "L4_261", "L4_262", "L4_262N", "Se_W", "Se_Z", "Se_Tm23", "Se_Tm24", "Se_O", "Se_N", "Se_Tm21", "Se_Tm22", "Se_R", "Se_S", "Se_P", "Se_K", "Se_H", "Se_Tm6", "Se_G", "Se_F", "Se_J", "Se_Tm5", "Se_Tm3", "Se_Tm4", "Se_Tm2", "Se_Tm1", "Se_A", "Se_C", "Se_B", "L575_25N", "L575_25", "L4_197N", "L4_197", "L4_198", "L4_198N", "Zy_A", "Zy_B", "L4_185N", "L4_185", "L4_184", "L4_184N", "Mr_B", "Mr_A", "L4_167N", "L4_167", "L4_168", "L4_168N", "Kr_W", "Kr_Z", "Kr_Tm23", "Kr_Tm24", "Kr_R", "Kr_P", "Kr_O", "Kr_S", "Kr_Tm22", "Kr_Tm21", "L1_397", "L1_397N", "L1_398N", "L1_398", "Mr_C", "Kr_F", "Kr_J", "Kr_H", "Kr_G", "Kr_Tm2", "Kr_Tm1", "Kr_C", "Kr_B", "L4_109N", "L4_109", "L4_108", "L4_108N", "L4_91N", "L4_91", "L4_90", "L4_90N", "L1_383", "L1_383N", "L1_382N", "L1_382", "L4_73N", "L4_73", "L4_74", "L4_74N", "L1_367", "L1_367N", "L1_368N", "L1_368", "L1_354N", "L1_354", "L1_355", "L1_355N", "L4_50", "L4_51N", "L4_51", "L1_340N", "L1_340", "L1_341", "L1_341N", "L4_50N", "L4_31N", "L1_328N", "L1_328", "L1_327", "L1_327N", "L4_31", "L4_32N", "L4_32", "Gr_X", "Gr_Z", "Gr_Tm37", "Gr_Tm38", "Gr_P3", "Gr_Y", "Gr_Tm35", "Gr_Tm36", "Gr_P2", "Gr_W", "Gr_P1", "Gr_Tm39", "Gr_P4", "Gr_Tm34", "Gr_Tm33", "Gr_Tm31", "Gr_Tm29", "Gr_Tm30", "Gr_Tm32", "Gr_O4", "Gr_O3", "Gr_N3", "Gr_Tm26", "Gr_Tm25", "Gr_Tm27", "Gr_Tm24", "Gr_Tm28", "Gr_M3", "Gr_Tm23", "Gr_Tm22", "Gr_M4", "Gr_N4", "Gr_M14", "Gr_M1", "Gr_M2", "Gr_M11", "Gr_Tm21", "Gr_Tm11", "Gr_Tm12", "Gr_H1", "Gr_H2", "Gr_Tm13", "Gr_H3", "Gr_H4", "Gr_Tm10", "Gr_H11", "Gr_H14", "Gr_Tm7", "Gr_Tm6", "Gr_Tm9", "Gr_Tm8", "Gr_G3", "Gr_G4", "Gr_Tm5", "Gr_Tm3", "Gr_Tm2", "Gr_Tm4", "Gr_D", "Gr_C", "Gr_Tm1", "Gr_A", "Gr_B", "L447_270", "L447_271N", "L447_271", "L447_270N", "L1_266N", "L1_266", "L1_267", "L1_267N", "L1_253S", "L1_253SN", "L1_252S", "L447_252", "L447_253", "L447_253N", "L1_252SN", "L447_252N", "L1_237SN", "L447_238N", "L447_238", "L1_237S", "L447_237", "L447_237N", "L1_238SN", "L1_238S", "L1_223SN", "L447_223N", "L447_228N", "L447_228", "L1_222SN", "L1_222S", "L1_223S", "L447_223", "L1_207S", "L1_207SN", "L1_208SN", "L1_208S", "L447_207", "L447_207N", "L447_208N", "L447_208", "L1_193S", "L1_193SN", "L447_193", "L447_193N", "L447_194N", "L447_194", "L1_194SN", "L1_194S", "Pr_Tm65", "Pr_W", "Pr_Tm64", "Pr_X", "Pr_Y", "Pr_Z", "Pr_Tm54", "Pr_Tm49", "Pr_Tm48", "Pr_Tm47", "Pr_Tm63", "Pr_Tm62", "Pr_Tm50", "Pr_Tm51", "Pr_Tm61", "Pr_Tm53", "Pr_Tm45", "Pr_Tm46", "Pr_Tm52", "Pr_Tm44", "Pr_L1", "Pr_Tm42", "Pr_L4", "Pr_Tm41", "Pr_Tm43", "Pr_L3", "Pr_L13", "Pr_L7", "Pr_L11", "Pr_L5", "Pr_L2", "Pr_H1", "Pr_K5", "Pr_K2", "Pr_J2", "Pr_Tm35", "Pr_Tm36", "Pr_H13", "Pr_H11", "Pr_H7", "Pr_Tm27", "Pr_Tm33", "Pr_Tm23", "Pr_Tm24", "Pr_Tm30", "Pr_Tm34", "Pr_Tm31", "Pr_Tm22", "Pr_Tm26", "Pr_Tm21", "Pr_Tm25", "Pr_Z101", "Pr_Tm29", "Pr_Tm32", "Pr_Tm28", "Pr_Z102", "Pr_G2", "Pr_G4", "Pr_Tm6", "Pr_Tm9", "Pr_G1", "Pr_Tm11", "Pr_Tm4", "Pr_Tm12", "Pr_Tm8", "Pr_Tm7", "Pr_G3", "Pr_Tm5", "Pr_Tm10", "Pr_B", "Pr_D", "Pr_Tm3", "Pr_C", "Pr_Tm1", "Pr_Tm2", "Pr_A", "L447_139", "L447_139N", "L1_135SN", "L447_140N", "L447_140", "L1_140S", "L1_135S", "L1_140SN", "L447_128", "L447_127", "L447_127N", "Jz_F", "L447_128N", "Jz_E", "Jz_D", "L447_117", "L447_117N", "Jz_C", "L447_116N", "L447_116", "Jz_A", "Jz_B", "L1_102SN", "L1_102S", "L447_101", "L447_101N", "L447_102", "L447_102N", "L1_101S", "L1_101SN", "L1_87S", "L1_87SN", "L447_86N", "L447_86", "L1_86SN", "L1_86S", "L447_87", "L447_87N", "Wl_Z", "Wl_X", "Wl_V", "Wl_Y", "Wl_R", "Wl_S", "Wl_P", "Wl_M", "Wl_T", "Wl_U", "Wl_K", "Wl_W", "Wl_L", "Wl_N", "Wl_G12", "Wl_J", "Wl_H", "L1_55SN", "Wl_A", "L447_62", "Wl_B", "L3_62L", "L447_57", "L447_57N", "Wl_E", "Wl_C", "L447_63N", "Wl_D", "L1_60S", "L1_55S", "L3_56L", "L3_56LN", "L447_56", "L447_56N", "L1_60SN", "L3_52", "L1_45S", "L1_45SN", "L3_46LN", "L3_46L", "L3_52N", "L447_52", "L447_49", "L447_49N", "L447_52N", "WCz_Tm15", "WCz_Tm16", "WCz_M", "L1_46SN", "L1_46S", "L447_42", "WCz_Tm10", "L447_43", "L447_43N", "WCz_K", "WCz_F", "WCz_O", "WCz_P", "WCz_N", "WCz_Tm11", "WCz_H", "WZD_N", "L447_42N", "WZD_Tm204", "WZD_Tm203", "WZD_Tm94", "WZD_Tm95", "WZD_Tm87", "WZD_Tm96", "WZD_Tm102", "WZD_Tm103", "WZD_Tm211", "WZD_S203", "WZD_S204", "WZD_S202", "WZD_S201", "WZD_Tm212", "WZD_Tm214", "WZD_Tm215", "WZD_Tm217", "WZD_S214", "WZD_S213", "WZD_S212", "WZD_Tm216", "WZD_Tm92", "WZD_Tm75", "WZD_L104", "WZD_L102", "WZD_Tm76", "L3_38LN", "WZD_Tm55", "WZD_Tm56", "WZD_O", "WZD_R", "WZD_Tm86", "WZD_Z", "WZD_Tm79", "WZD_W", "WZD_U1", "WZD_X", "WZD_Y", "WZD_U2", "WZD_Tm65", "WZD_Tm66", "WZD_Tm63", "WZD_Tm67", "WZD_Tm64", "WZD_P", "Och1_Tm62", "WZD_T", "WZD_Q", "L447_37", "WZD_Tm213", "WZD_S211", "WZD_M104", "WZD_M102", "WZD_Tm93", "L447_36N", "WZD_Tm81", "WZD_Tm85", "WZD_Tm91", "WZD_Tm77", "WZD_Tm78", "WZD_G4", "WZD_K1", "WZD_G3", "WZD_R610", "WZD_K6", "WZD_Tm72", "WZD_H36", "WZD_G2", "WZD_G6", "L47_O26", "WZD_K3", "WZD_K5", "WZD_Tm202", "WZD_Tm90", "WZD_Tm89", "WZD_Tm88", "WZD_Tm101", "WZD_Tm210", "WZD_Tm80", "WZD_K4", "WZD_Tm74", "WZD_Tm47", "WZD_Tm22", "WZD_Tm41", "WZD_Tm46", "WZD_J23", "WZD_H23", "WZD_J21", "WZD_Tm39", "WZD_Tm51", "WZD_Tm45", "WZD_Tm48", "WZD_Tm52", "WZD_Tm42", "WZD_J22", "WZD_Tm43", "WZD_Tm44", "WZD_Tm38", "WZD_Tm54", "L47_O27", "WZD_Tm208", "WZD_Tm209", "WZD_Tm50", "WZD_Tm49", "WZD_G8", "WZD_K8", "WZD_Tm207", "WZD_Tm58", "WZD_Tm57", "WZD_Tm53", "WZD_J20", "WZD_J25", "WZD_K2", "WZD_Tm71", "WZD_Tm61", "WZD_G5", "WZD_S2G", "WZD_S1G", "WZD_Tm21", "WZD_H20", "WZD_H21", "WZD_H22", "WZD_G1", "WZD_Tm10", "WZD_Tm12", "WZD_Tm13", "WZD_Tm16", "WZD_Tm14", "WZD_F", "L2_2DN", "WZD_E", "WZD_Tm2", "WZD_Tm5", "WZD_Tm20", "WZD_Tm17", "WZD_Tm1", "WZD_Tm18", "WZD_Tm19", "WZD_Tm4", "WZD_Tm3", "WZD_D", "WZD_Tm6", "WZD_Tm23", "WZD_Tm9", "WZD_Tm11", "WZD_Tm7", "WZD_Tm8", "L448_2N", "WZD_A", "WZD_B", "WZD_C", "L2_1D", "L448_1", "L47_O17", "L47_O16", "L448_3", "L448_3N", "L2_3DN", "L2_3D", "L2_4D", "L2_4DN", "WKD_A", "L448_6", "L448_6N", "L448_5", "L448_5N", "L2_5DN", "WDC_Tm2", "WDC_A", "WDC_Tm1", "WKD_B", "WKD_Tm1", "WKD_C", "L448_8N", "L448_8", "WKD_Tm2", "L2_6D", "WDC_B", "WDC_F", "WDC_E", "WDC_D", "WDC_C", "WDC_K", "WDC_J", "WDC_H", "WDC_G", "WDC_R", "L448_7N", "WKD_Tm4", "WKD_F", "WKD_E", "WKD_D", "L448_7", "WDC_L", "WDC_O", "WDC_T", "WDC_P", "WDC_S", "L448_12", "L448_12N", "L2_2DNN", "WDC_Tm4", "WDC_M", "WDC_N", "WDC_Tm3", "L448_15N", "L448_15", "WDC_U", "L448_19", "L2_3DD", "WDC_W", "L448_19N", "L448_18N", "L448_18", "L2_11D", "L2_11DN", "L2_10D", "L2_10DN", "L448_22", "L448_22N", "L2_13D", "L2_12DN", "L2_13DN", "L2_12D", "L448_23", "L448_23N", "L448_26", "L448_26N", "L2_15DN", "L2_14D", "L2_14DN", "L2_15D", "L448_27", "L448_27N", "L448_28", "L448_28N", "L2_16D", "L2_16DN", "L2_17D", "L2_17DN", "L2_19DN", "WSD_A", "L2_18D", "WSD_B", "WSD_D", "WSD_C", "WSD_E3", "WSD_F", "WSD_Tm105", "WSD_Tm101", "WSD_E4", "WSD_Tm2", "WSD_Tm1", "WSD_Tm5", "WSD_Tm4", "WSD_J24", "WSD_J3", "WSD_Tm8", "WSD_J2", "WSD_J1", "WSD_Tm11", "WSD_Tm14", "WSD_Tm10", "WSD_Tm9", "WSD_Tm15", "WSD_J12", "WSD_J10", "WSD_J8", "WSD_J6", "WSD_J4", "WSD_J5", "WSD_H", "WSD_K1", "WSD_Tm13", "WSD_Tm22", "WSD_Tm21", "WSD_J22", "WSD_K22", "WSD_J20", "WSD_K20", "WSD_J21", "WSD_J23", "WSD_K3", "WSD_Tm23", "WSD_Tm29", "WSD_Tm24", "WSD_Tm28", "WSD_K4", "WSD_K21", "WSD_K23", "WSD_Tm25", "WSD_Tm33", "WSD_Tm34", "WSD_Tm35", "WSD_Tm45", "WSD_K2", "WSD_K6", "WSD_L4", "WSD_Tm56", "WSD_L18", "WSD_K8", "WSD_K10", "WSD_L70", "WSD_Tm81", "WSD_Tm80", "WSD_K12", "WSD_L16", "WSD_Tm30", "WSD_Tm39", "WSD_Tm32", "WSD_Tm40", "WSD_K24", "WSD_Tm114", "WSD_Tm113", "WSD_Tm117", "WSD_Tm111", "WSD_Tm118", "WSD_K5", "WSD_Tm42", "WSD_Tm41", "WSD_Tm37", "WSD_U", "WSD_Tm48", "WSD_Tm44", "WSD_Tm46", "WSD_Tm43", "WSD_Tm59", "WSD_Tm61", "WSD_Tm62", "WSD_Tm64", "WSD_M18", "WSD_Tm57", "WSD_M16", "WSD_M70", "WSD_Tm122", "WSD_N28", "WSD_R", "WSD_N23", "WSD_Tm123", "WSD_Tm124", "WSD_O", "WSD_N21", "WSD_Tm121", "WSD_L28", "WSD_L30", "WSD_P", "WSD_L26", "WSD_N26", "WSD_N30", "WSD_T", "WSD_Tm73", "WSD_Tm36", "WSD_Tm63", "WSD_V", "WSD_Tm66", "WSD_Tm65", "L45_116", "WSD_Z", "WSD_S", "Pd_T", "Pd_C", "WSD_X", "WSD_Y", "L4_1655N", "L4_1655", "L4_1656", "L4_1656N", "L4_1641N", "L4_1641", "L4_1642", "L4_1642N", "Sp_A", "Sp_B", "Sp_C", "Sp_D", "L4_1624N", "L4_1624", "L4_1625", "L4_1625N", "Kn_E", "Kn_F", "Kn_B", "Kn_C", "Kn_A", "L4_1587N", "L4_1586", "L4_1586N", "L4_1587", "L571_19N", "L571_19", "Cz_Z", "Cz_X", "Cz_Y", "L4_1565", "L4_1565N", "L4_1564", "L4_1564N", "L572_25", "L572_25N", "Ch1_H", "Ch1_Sz1N", "WP_T", "WP_U", "WP_S", "WP_Tm27", "WP_Tm31", "WP_Tm30", "WP_Tm29", "WP_Tm28", "WP_R", "Ch1_E", "Ch1_F", "Ch1_G", "Cz_O", "WP_Tm26", "WP_Tm25", "WP_Tm24", "WP_L", "WP_Tm23", "WP_M", "WP_N", "WP_Tm22", "WP_Tm21", "WP_P", "WP_K", "WP_G", "WP_Tm8", "WP_Tm7", "WP_Tm9", "WP_J", "WP_H", "WP_F", "WP_E", "WP_Tm4", "WP_Tm6", "Ch_D", "Ch_K", "Ch_B", "Ch_C", "WP_Tm5", "WP_Tm3", "WP_Tm2", "WP_Tm1", "WP_A", "WP_B", "Ch_Y", "Ch_A", "Ch_X", "L4_1511N", "L4_1510", "L4_1511", "L4_1510N", "L4_1489N", "L4_1489", "L4_1490", "L4_1490N", "L4_1469N", "L4_1469", "L4_1470", "L4_1470N", "Tl_M", "Tl_N", "Tl_Tm23", "Tl_Tm12", "Tl_Tm21", "Tl_Tm22", "Tl_Tm24", "Tl_Tm25", "Tl_G", "Tl_Tm5", "Tl_Tm11", "Tl_J", "Tl_H", "Tl_Tm4", "Tl_Tm3", "Tl_Tm2", "Tl_Tm7", "Tl_Tm6", "Tl_S", "Tl_R", "Tl_Tm1", "Tl_C", "Tl_D", "Tl_E", "Tl_A", "Tl_B", "L4_1455N", "L4_1455", "L4_1454", "L4_1454N", "L62_2666", "L62_2665N", "L62_2639", "L62_2640N", "L62_2664N", "L62_2663", "L62_2645N", "L62_2646", "Kz_Tm30", "Kz_Tm29", "Kz_X", "Kz_Y", "Kz_Tm23", "Kz_S1", "Kz_S5", "Kz_Tm21", "Kz_S7", "Kz_Tm22", "Kz_Tm24", "Kz_R2", "Kz_R6", "Kz_S3", "Kz_Tm17", "Kz_Tm18", "Kz_Tm15", "Kz_Tm19", "Kz_R4", "Kz_Tm16", "L4_1432", "L4_1432N", "L4_1433N", "L4_1433", "L62_2655N", "L62_2656", "L62_2650N", "L62_2649", "Kz_Tm10", "Kz_Tm11", "Kz_F1", "Kz_F3", "Kz_Tm13", "Kz_Tm14", "Kz_F7", "Kz_Tm7", "Kz_Tm8", "Kz_Tm9", "Kz_F5", "Kz_G4", "Kz_G6", "Kz_G2", "Kz_Tm5", "Kz_Tm6", "Kz_Tm1", "Kz_Tm2", "Kz_Tm4", "Kz_D", "Kz_A", "Kz_Tm3", "Kz_C", "Kz_B", "L4_1413N", "L4_1413", "L4_1412", "L4_1412N", "Sd3_J2", "Sd3_J1", "L4_1393N", "L4_1393", "L4_1392", "L4_1392N", "Gn_B", "Gn_A", "Sd3_Tm11", "Sd3_Tm13", "Sd3_Tm12", "L4_1369N", "L4_1369", "L4_1370", "L4_1370N", "L4_1355N", "L4_1354", "L4_1355", "L4_1354N", "Sd3_H4", "Sd3_H1", "Sd3_H7", "Sd3_H11", "Sd3_H9", "Sd_G4", "Sd3_Tm18", "Sd3_H3", "Sd_G2", "L4_1333N", "L4_1333", "L4_1332", "L4_1332N", "L4_1309N", "L4_1309", "L4_1310", "L4_1310N", "L4_1295N", "L4_1295", "L4_1296", "L4_1296N", "L4_1281N", "L4_1281", "L4_1280", "L4_1280N", "L4_1266N", "L4_1267N", "L4_1267", "L4_1266", "Ol_T", "Ol_Tm15", "Ol_W", "Ol_Tm14", "Ol_Tm12", "Ol_Tm13", "Ol_N", "Ol_M", "Ol_L", "Ol_O", "Ol_Tm11", "Ol_H", "Ol_G", "Ol_F", "Ol_E", "Ol_Tm1", "Ol_Tm4", "Ol_Tm3", "Ol_Tm2", "Ol_B", "Ol_A", "Sd_Tm28", "Sd_Tm5", "Sd_Tm29", "Sd_Tm17", "Sd_Tm15", "Sd_F3", "Sd_Tm6", "Sd_Tm8", "Sd_F5", "Sd_F7", "Sd_Tm4", "Sd_L", "Sd2_Tm2", "Sd_E", "Sd2_Tm3", "Sd_Tm20", "L4_1217N", "L4_1217", "L4_1216", "L4_1216N", "Sd_Tm27", "Sd_K", "Sd2_Tm26", "Sd1_Tm23", "Sd_Tm25", "Sd2_D51", "Sd2_D53", "Sd2_D55", "Sd2_D57", "Sd_Tm24", "Sd1_Tm22", "Sd1_Tm21", "L4_1197N", "L4_1997", "L4_1196", "L4_1196N", "Sd1_B2", "Sd1_B1", "Sd1_C57", "Sd1_C59", "Sd1_C55", "Sd1_C51", "Sd1_C61", "Sd1_C53", "Sd1_Tm1", "Sd1_C200", "L4_1181N", "L4_1181", "L4_1180", "L4_1180N", "Sd1_A1", "Sd1_A2", "L4_1162", "L4_1162N", "L4_1163N", "L4_1163", "L4_1145N", "L4_1145", "L4_1146", "L4_1146N", "L4_1131N", "L4_1131", "L4_1130", "L4_1130N", "L4_1109N", "L4_1109", "L4_1108", "L4_1108N", "L4_1087N", "L4_1087", "L4_1088", "L4_1088N", "Pl_D", "Pl_C", "Pl_A", "Pl_B", "L4_1041N", "L4_1041", "L4_1040", "L4_1040N", "L4_1019N", "L4_1019", "L4_1018N", "L4_1018", "L4_1001N", "L4_1001", "L4_1000", "L4_1000N", "L4_983N", "L4_983", "L4_982N", "L4_982", "L4_967N", "L4_967", "L4_968N", "L4_968", "L4_953N", "L4_953", "L4_952", "L4_952N", "OP_T", "OP_W", "OP_Tm14", "OP_Tm15", "OP_Tm12", "OP_N", "OP_Tm13", "OP_Tm11", "OP_M", "OP_O", "OP_L", "OP_F", "OP_E", "OP_G", "OP_H", "OP_Tm4", "OP_Tm2", "OP_Tm1", "l137_ktc_u1", "l137_ktc_u2", "l137_ktc_u5", "l137_ktc_y", "l137_ktc_x", "DTA_F2", "DTA_F1", "DTA_E1", "DTA_Tm11", "DTA_Tm1", "DTA_Tm2", "DTA_A", "DTA_B", "DTA_D", "DTA_C2", "DTA_Tm3", "DTA_C1", "DTA_Tm4", "Pmi_A", "Pmi_B", "Pmi_D", "Pmi_C", "Kzl_B", "Kzl_C", "Kzl_G", "Kzl_J", "Kzl_L", "MW_A", "MW_B", "My_C", "My_D", "My_B", "My_A", "L8_2699", "L8_2700N", "L8_2703N", "L8_2704", "L8_2719", "L8_2721N", "L8_2722", "L8_2720N", "L8_2373N", "L8_2374", "L8_2731", "L8_2730N", "L8_2756", "L8_2756N", "L8_2757N", "L8_2757", "L8_2745N", "L8_2745", "L8_2744", "L8_2744N", "Mi_M", "Mi_Tm7", "Mi_K", "Mi_J", "Mi_L", "Mi_Tm6", "Mi_D", "Mi_C", "Mi_Tm1", "Mi_Tm3", "Mi_E", "Mi_F", "Mi_Tm4", "Mi_Tm2", "Mi_A", "Mi_B", "Mi_Tm13", "Mi_Tm14", "Mi_Tm11", "Mi_Tm10", "Mi_Tm9", "Mi_Tm12", "Mi_O", "Mi_N", "SDT_A", "SDT_B", "SDT_D", "SDT_C", "WZD_T2G", "WZD_T1G", "Zy_D", "Zy_C", "L8_2799", "L8_2798", "L8_2798N", "L8_2799N", "L8_2812", "L8_2812N", "L8_2811N", "L8_2811", "L8_2828", "L8_2828N", "L8_2827N", "L8_2827", "L8_2842", "L8_2842N", "L8_2843N", "L8_2843", "WGT_B", "WGT_A", "WGT_D", "Gl_B", "Gl_A", "Gl_C", "L8_2857N", "L8_2857", "L8_2858", "L8_2858N", "L8_2868", "L8_2868N", "L8_2869N", "L8_2869", "L8_2882", "L8_2882N", "L8_2883N", "L8_2883", "3923_Sm_J", "3923_Sm_K", "3923_Sm_Tm22", "3923_Sm_Tm21", "3923_Sm_H", "3923_Sm_G", "3923_Sm_Tm8", "3923_Sm_Tm7", "3923_Sm_C", "3923_Sm_F", "3923_Sm_Tm9", "3923_Sm_A", "3923_Sm_B", "3923_Sm_Tm3", "3923_Sm_Tm4", "3923_Sm_E", "3923_Sm_D", "3923_Sm_L", "3923_Sm_M", "L8_2925", "L8_2924N", "L8_2925N", "L8_2924", "L8_2935", "L8_2936N", "L8_2935N", "L8_2936", "2820_Nd_B", "2820_Nd_A", "2820_Nd_F", "2820_Nd_E", "2820_Nd_Tm9", "2820_Nd_D", "2820_Nd_Tm6", "2820_Nd_Tm7", "2820_Nd_G", "2820_Nd_Tm8", "2820_Nd_Tm5", "2820_Nd_Tm4", "2820_Nd_Tm3", "2820_Nd_Tm2", "2820_Nd_Tm1", "2820_Nd_Tm15", "2820_Nd_Tm17", "2820_Nd_Tm19", "2820_Nd_Tm18", "2820_Nd_Tm14", "2820_Nd_K", "2820_Nd_L", "2820_Nd_M", "2820_Nd_N", "2820_Nd_Tm13", "L8_2983N", "L8_2984", "L8_2982N", "L8_2981", "L8_2994", "L8_2993N", "L8_2994N", "L8_2993", "2820_Nd_P", "2820_Nd_R", "L8_3007N", "L8_3007", "L8_3008", "L8_3008N", "L8_3017N", "L8_3018", "L8_3017", "L8_3018N", "L8_3029", "L8_3028", "L8_3031N", "L8_3032", "L8_3043N", "L8_3043", "L8_3044N", "L8_3058", "L8_3058N", "L8_3057", "L8_3057N", "L8_3044", "5251_Zs_P", "5251_Zs_R", "5251_Zs_Tm7", "5251_Zs_L", "5251_Zs_Tm6", "5251_Zs_H", "5251_Zs_J", "5251_Zs_K", "5251_Zs_F", "5251_Zs_C", "5251_Zs_Tm2", "5251_Zs_D", "5251_Zs_Tm1", "5251_Zs_Tm3", "5251_Zs_E", "5251_Zs_A", "5251_Zs_B", "3475_Rc_B", "3475_Rc_A", "DS_R", "3475_RC_ToD", "3475_Rc_ISpE", "5465_KGA_ISpE304", "5465_KGA_ToF2", "5465_KGA_ToF1", "1952_KG_ISpP102", "1952_KG_ISpP104", "1952_KG_IISpP104", "2020_KPm_ToD", "1952_KG_IISpR11", "2020_KPm_IISpR12", "1952_KG_ISpT3", "1952_KG_ISpT1", "1952_KG_ISpU3", "1952_KG_ISpU11", "2020_KPm_ISpG", "1952_KG_ISpT12", "1952_KG_ISpT2", "1952_KG_ISpT4", "1952_KG_ISpU2", "1952_KG_ISpU10", "1952_KG_ISpU12", "1952_KG_ISpU8", "1952_KG_ISpU6", "5465_KGA_ISpG304", "5465_KGA_ISpG303", "Za_ToD", "Za_ToC", "Za_IISpA", "Za_ISpA", "Za_ISpB", "Za_ToA", "Za_ToB", "Ga_ToC", "Ga_ToA", "Ga_ToB", "Ga_ToD", "SMA_ToB2", "SMA_ToB", "Dra_ToC", "Dra_ToD", "KMB_ToY25", "Ssc_ISpE", "KMB_ToP", "Ssc_ISpB", "Ssc_ISpD", "Ssc_IISpD", "Ssc_IIISpD", "KMB_ISpY25", "Ssc_ToB", "Ssc_ToD", "KO_ISpM8", "KO_ISpN3", "KO_ISpN9", "KO_ISpM2", "KO_ISpN5", "KO_ISpM9", "Kz_ToC", "StA_ToA", "Kz_ToB", "KMB_ToM", "KMB_ToL", "KO_ToC", "KO_ToA", "KJw_ToZ", "KJw_ToH", "Sk_ToM", "Sk_ToE", "KJw_ToA", "KJw_ToW", "Sk_IISpK", "Sk_ISpK", "Sk_ISpL", "Sk_ISpD", "Sk1_ISpC", "Sk1_ISpA", "Sk_ToD", "SG_ISpU1", "SG_ISpU2", "MW_ISpU", "SG_ISpP", "SG_IISpP", "SG_ISpS", "SG_ISpH2", "SDn_ToZ", "SG_ISpC", "SG_IISpC", "SG_ToC", "B_ToP", "B_ISpK4", "SDn_ToW", "SPł1_ToA", "SDn_ISpA", "SDn_ISpB", "Ju_ToG", "Ju_ToH", "SDn_ToA", "SDn_ToB", "L1__2980", "L1_2981N", "L62_757N", "Ju_ISpH", "SKz_ToS", "L1_2981", "L1__2980N", "SKz_ISpL", "SKz_IISpF", "SKz_ISpK", "SKz_ISpJ", "SKz_IISpH", "SKz_ISpC", "SKz_IISpE", "SKz_ISpF", "SKz_IISpG", "SKz_ISpO", "SKz_ISpR", "SKz_ISpH", "SKz_ISpG", "SKz_ISpE", "Ju_ISpA", "SKz_ToA", "L62_725", "L62_704", "Ju_ToB", "Ju_ToA", "DS_ToW", "DS_ISpW", "DS_IISpW", "DZ_ISpV", "DZ_ToZ", "DZ_ToY", "DZ_ISpZ", "DZ_IISpZ", "DZ_ISpY", "DZ_IISpY", "DGHK_ToH", "DGHK_ToG", "Dra_ToA", "DGHK_IISpL", "DGHK_IISpM", "DGHK_ISpL", "DGHK_ISpM", "Dra_ToE", "Dra_IISpA", "Dra_IIISpA", "Dra_ISpA", "DGHK_ToL", "DGHK_ToM", "Dra_IISpE", "Dra_IIISpE", "Dra_ISpE", "DW_ToA", "DW_ToB", "DP_ToL", "DP_ToA", "Dra_ISpL", "Dra_ISpM", "DP1_ToM", "DP1_ToK", "Dra_IISpL", "Dra_ToL", "DW_ToD", "Dra_ToM", "DW_ToC", "Dra_ToJ", "Dra_ToK", "DW_ISpB", "DW_ISpA", "DW_IIISpD", "DW_IISpD", "DW_IISpC", "DS_ToA", "DS_ToB", "DW_IIISpC", "DW_ISpD", "DW_ISpC", "DW_ToX", "DW_ToW", "DW_ToT", "DW_ToU", "LC_ToT", "LC_ToZ", "Sl_ToK", "Sl_ToJ", "LC_ISpT", "Kzl_ToB", "Kzl_ToC", "LB_ToM4", "LB_ToM6", "LB_ToP3", "LB_ToP7", "LC_ToS7", "Sl_ISpC", "LB_ISpP1", "LB_ISpP2", "LC_ToS4", "LC_ToS6", "LB_IISpP2", "LB_IISpP1", "LC_ToS3", "Sl_ToB", "Sl_ToC", "L62_576N", "L62_575", "LA_ToH324", "LB_ToQ123", "LB_ToQ125", "LA_ISpE124", "LA_ISpE126", "LA_ISpE128", "LA_ISpE130", "LA_ISpE132", "LA_ISpE134", "LA_ISpE136", "LA_ISpE138", "L62_573", "L62_574N", "LA_IISpC1", "LA_IIISpC1", "LA_IISpC2", "LA_IIISpC2", "LA_ISpD3", "LA_IISpD3", "LA_ISpC1", "LA_ISpC2", "Zw_ISpP116", "Zw_ISpP118", "Zw_ISpP120", "Zw_IISpS23", "Zw_ISpS23", "Zw_ISpP114", "Zw_ISpK", "Zw_IISpK", "Bo_ToK", "Bo_ToL", "Bo_ISpF6", "Bo_ISpF8", "Bo_ISpB", "Bo_ISpA", "Bo_ToA", "Bo_ToB", "Bo_ToG", "O1_ToH", "O_ToA", "JO_ToH", "JO_ISpH", "LHS2_SpL", "LHS2_ToL", "JO1_ToA", "LHS1_ToF", "LHS1_ToA", "L62_264N", "L62_263", "L62_261", "L62_262N", "W_ToK", "L62_203", "L62_204N", "Str_ToD", "W1_ToA", "L62_201", "L62_202N", "Str_ToB", "Str_ToA", "L64_265N", "L64_264", "L64_264N", "L64_265", "Rd_ToM", "Rd1_ToL", "Mr_ToB", "Mr_ToA", "L1_385N", "L1_384", "L1_404N", "L1_405", "L1_385", "L1_384N", "Gr_ISpO4", "Gr_IISpO4", "Gr_ISpM11", "Gr_ISpM14", "Gr_ISpM3", "Gr_ISpM4", "Gr_ISpM1", "Gr_ISpM2", "Jz_ISpD", "Jz_IIISpB", "L447_75N", "L1_76SN", "L1_76S", "Wl_ISpX", "L447_44W", "L445_45NW", "WZD_ToR", "WZD_ToP", "WZD_ToN", "L447_44NW", "WZD_ISpR", "L445_45W", "WZD_ISpS211", "WZD_ISpT1G", "WZD_IISpS2G", "WZD_ISpS2G", "WZD_ISpT2G", "WZD_IIISpS1G", "WZD_ToR610", "WKD_ToA", "WDC_ISpN", "WDC_ISpM", "WDC_ISpL", "WSD_ISpE3", "WSD_ISpE4", "WSD_ISpV", "WSD_ISpU", "L64_204", "L64_203N", "L64_190", "L64_189N", "L64_204N", "Sp_ToD", "Sp_ToC", "L64_203", "L64_156", "L64_157N", "L64_190N", "L64_189", "L64_168N", "L64_167", "L64_150", "Sp_ToA", "L64_149N", "Sp_ToB", "L64_130", "L64_156N", "L64_131N", "L64_157", "L64_150N", "L64_149", "Ch1_ToH", "L64_119N", "L64_118", "Cz_ISpY", "L64_130N", "L64_131", "WP_IISpR", "WP_ISpR", "L64_92", "L64_91N", "L64_118N", "L64_119", "Ch_ToA", "Ch_ToX", "L64_62", "L64_92N", "L64_61N", "L64_91", "L64_57N", "L64_56", "Tl_ToN", "Tl_ToM", "L64_45N", "L64_44", "Tl_ISpM", "Tl_ISpN", "Tl_IIISpN", "Tl_IIISpM", "Tl_IISpN", "Tl_IISpM", "Tl_ISpJ", "Tl_ISpH", "Tl_ISpG", "L64_62N", "L64_61", "L64_57", "L64_56N", "L64_45", "L64_44N", "Kz_ISpD", "Kz_ToD", "Kz_ToA", "Gn_ToB", "Sd3_ToJ2", "Sd3_ToJ1", "Gn_ToA", "L4_985N", "L4_986", "L4_985", "L4_986N", "DTA_ISpF2", "DTA_ISpF1", "DTA_IISpF1", "DTA_IISpF2", "Kzl_ToJ", "Kzl_ToG", "DTA_ToE1", "Kzl_ToL", "DTA_ToD", "DTA_ISpA", "DTA_ISpB", "DTA_ISpD", "DTA_IISpD", "DTA_ToA", "DTA_ToB", "Pmi_ToC", "Pmi_ToD", "Kzl_ISpJ", "Kzl_ISpL", "3475_Rc_ToB", "5251_Zs_ToP", "3475_Rc_ToA", "5251_Zs_ToR", "L160_2867N", "L186_2866", "L160_2867", "L160_2866N"
];