## Basics

+ The type name must be lowercase, e.g. `beddetail` despite `track type=bedDetail`.

+ `.parse()`, `.prerender()`, and `.render()` MUST be defined.

+ `.renderWithSequence()` SHOULD be defined for formats that draw things based on the nucleotide sequence, which may arrive later than the initial render request.
    
    - The way to signal that the track expects sequence is by setting `this.expectsSequence` to `true`. Optionally, if more sequence to the left or right of a tile is also needed for it to draw, a padding amount can be set in `this.expectedSequencePadding` (the default is 0).

+ `.loadOpts()` and `.saveOpts()` MAY be defined to handle dynamic updating of options via the Custom Track options dialog.

+ `.finishSetup()` MAY be defined, and it will be called right before the custom track is about to display. It is useful for deferring expensive setup operations for a custom track that may not be initially visible. See the "bigbed" format for an example of how to use this.

+ `.search()` MAY be defined, if the track is to be searchable from the browser's location bar. This should fire the passed in  callback on a search results object. Note that the track's `.isSearchable` attribute should be set to `true` to activate this behavior. See the "bigbed" format for an example, and also see `._searchFor()` in `$.ui.genobrowser`.

+ Defaults for track options can be put in `.defaults`.

## Data flow between methods

+ The point of a format definition is to store data parsed from the track during `.parse()` and then draw it to a canvas upon a call to `.render()`.

+ `.parse()` is handed an array of lines, which it can process as it likes.  It SHOULD fill `.data` with a convenient representation of the data found in the lines.  It MUST define `.heights`, `.sizes`, and `.mapSizes` in order for the  genobrowser to know what to do with the custom track.

+ To separate data retrieval and preprocessing (which can be handed off to a Web Worker to not block the UI thread) from drawing to the `<canvas>` and DOM operations (which unavoidably block the UI thread), `.render()` typically is built around a call to `.prerender()` that performs the data retrieval and preprocessing and hands off a `drawSpec` object to a callback. The callback, possibly defined inline within `.render()`, is responsible for drawing everything within `drawSpec` to the `<canvas>`. `drawSpec` is ideally the simplest data structure needed to quickly draw an image (e.g., rows of pixel positions.)

+ `.render()` MUST accept **1-based**, right-open **genomic** coordinates for its `start` and `end` parameters. As a result, the formats also store intervals in this coordinate system.

+ `.render()` MAY decide that there's too much data to fetch or draw in a reasonable amount of time. In this case, it SHOULD set the `too-many` class on the `<canvas>` element and set its height to 0 via `canvasElem.unscaledHeight(0)`. 
    
    - Zero-height tile data are considered a special case by ChromoZoom that indicates there was an error while drawing the data, and these densities are deprioritized in `genobrowser`'s `densityOrder` algorithm. However, if the tile was in fact drawn without errors, the height of the `<canvas>` element MUST be non-zero, even if no data needed to be rendered.

+ `.prerender()` can expect to access `.data` and all the `CustomTrack.prototype` methods, but not any of the DOM methods, since it MAY be running in a Web Worker.

+ `.render()` will not have access to `.data` or the `CustomTrack.prototype` methods if Web Workers are in use. It will always, however, have access to DOM methods.

+ `.renderSequence()` has access to the same object space as `.render()`, and MAY call `.prerender()` in the same fashion as `.render()`. If it has to draw certain objects *after* `.render()` (i.e., on top of what `.render()` drew), it must check the state of the canvas and register callbacks as necessary, because even though `.render()` is guaranteed to be called before `.renderSequence()`, they are both asynchronous and may draw things on the canvas at any time afterward. See the "bam" format for an example of how to do this.