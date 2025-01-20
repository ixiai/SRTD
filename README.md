# SRTD - SimRail Train Describer
_A fictional [train describer](https://wikirail.it/en/glossario/train-describer-2/) for the popular Polish railway simulator [SimRail](https://simrail.eu/en/)_

## Usage
SRTD is [currently hosted here](https://tplmilano.altervista.org/E/SRTD/index.html).
It is possible to change the SimRail server and flip the layout from the settings, which are stored in the URL.

SRTD updates every 5 seconds.

## Known issues

If a train is at > 5km from the next signal, SRTD will have no way to know with certainty where it is; it will,
however, make an educated guess, which will be corrected as soon as the train is at < 5km from the signal.
This should not cause any harm, since timetable, block orientation, telephone communications, rarity of such
long tracks with no signals and correction once the train is at < 5km should still provide all the info a player
would need. This comes from a limitation in SimRail APIs.

If two trains happen to be in the same block section, the only one shown on screen may not be the first one in line.
Will work on that ASAP.

The replay function (see below) still needs some polishing.

## Other versions
SRTD is released under __CC-BY-NC-SA 4.0__. Feel free to modify it as you wish! Just like...

https://besentv.github.io/ - by [Rokolell](https://forum.simrail.eu/profile/9783-rokolell/)

https://forum.simrail.eu/topic/10172-my-srtd/ - by [RWag64](https://forum.simrail.eu/profile/1871-rwag64/)


### Special functions
To replay, write `replay()` in the console.

To test a signal (for developers), write `test("signalName")` in the console; a fictional `#TEST#` train will appear on that
track until the next refresh.

### Edit a layout
Each track that may contain a train number is identified by `{────}`; at the end of each row there is a list
with the names of the signals located at each of the two ends of each track section, in order from left to right,
with the same name used in SimRail (see allSignals.txt for help), separated with a `'`.
If a track only has one signal, a blank/empty signal can be specified with the jolly `§`.
If two signals are related to the same track in the same direction (e.g. `L1_3037N` and `B_C` near Bedzin),
they can be written as `L1_3037N%B_C`.

### Contact info
Feel free to [contact me on the SimRail forum](https://forum.simrail.eu/profile/3395-angelo/)!
