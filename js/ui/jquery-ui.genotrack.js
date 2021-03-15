// ====================================================================
// = Each track within a $.ui.genoline is managed by a $.ui.genotrack =
// ====================================================================
/*jshint node: true */

module.exports = function($, _) {

var utils = require('./utils.js')($),
  pad = utils.pad,
  classFriendly = utils.classFriendly,
  shortHash = utils.shortHash,
  floorHack = utils.floorHack,
  uuid = utils.uuid;

// Polyfill Math.log10 for Internet Explorer
if (_.isUndefined(Math.log10)) { Math.log10 = function (x) { return Math.log(x) / Math.LN10; }; }

$.widget('ui.genotrack', {
 
  // Default options that can be overridden
  options: {
    disabled: false,
    scales: {},
    line: null,       // must be specified on instantiation
    side: null        // must be specified on instantiation
  },
 
  // Called automatically when widget is instantiated
  _init: function() {
	var self = this,
      $elem = this.element,
      o = this.options;
    if (!o.line) { throw "Cannot instantiate ui.genotrack without specifying 'line' option"; }
    if (!o.side) { throw "Cannot instantiate ui.genotrack without specifying 'side' option"; }
    self.ruler = o.track.n === 'ruler';
    self.sliderBppps = o.bppps.concat(o.overzoomBppps);
    self.areaLoadCounter = 0;
    self.custom = !!o.track.custom;
    self.birth = (new Date()).getTime();
    self.$side = $(o.side);
    self.$sideCont = $('<div class="subtrack-cont"><div class="scales"></div></div>').appendTo(self.$side);
    self.$sideBtns = $('<div class="buttons"></div>').appendTo(self.$sideCont);
    self.$scrollbar = $('<div class="scrollbar"></div>').appendTo(self.$sideCont);
    self.fixClippedDebounced = _.debounce(self.fixClipped, 500);
    if (self.custom) {
      o.scales = o.track.custom.scales;
      // Some custom track types defer expensive parts of setup until they're about to be displayed
      o.track.custom.finishSetupAsync();
      o.track.custom.onSyncProps = function(props) { self._customTrackPropsUpdated(props); };
      self._customCanvasCounter = 0;
    }
   
    $elem.addClass('browser-track-'+o.track.n).toggleClass('no-ideograms', self.ruler && !o.chrBands);
    self._nearestBppps(o.browser.genobrowser('zoom'));
    // If the track has multiple densities, or its single density has multiple fixed heights,
    // make the sidebar resizable
    self._initSideResizable();
    self._initSideButtons();
    self._scrollTop = 0;
    self._initSideScroll();
    self._availDensities();
    self.loadingCounter = 0;
    self._maxTileHeight = 0;
    $elem.attr('id', self.uniqId = $.uniqId('trk'));
    self.resize(o.track.h);
    self.updateDensity();
  },
 
  // the side element is resizable to permit track resizing
  _initSideResizable: function() {
    var self = this,
      $elem = this.element,
      o = self.options,
      bF = self._bpppFormat(o.bppps[0]),
      firstFixedHeight = _.uniq(_.pluck(o.track.fh, _.flatten(o.track.s)[0])),
      paddingBordersY = self.$side.outerHeight() - self.$side.height(),
      minHeight = (self.custom ? o.track.custom.heights.min : Math.min(_.min(o.track.fh[bF]), 32)) - paddingBordersY,
      $linesBelow, $h;
      
    var opts = {
      handles: 's',
      minHeight: minHeight,
      start: function(e, ui) {
        var bppp = self.bppps().top,
          fixedHeights = o.track.fh[self._bpppFormat(bppp)],
          customHeights = o.track.custom && o.track.custom.heights;
        $('body').addClass('row-resizing');
        if (self.custom) {
          if (customHeights.max) { $(this).resizable('option', 'maxHeight', customHeights.max - paddingBordersY); }
          if (customHeights.min) { $(this).resizable('option', 'minHeight', customHeights.min - paddingBordersY); }
        }
        if (!self.ruler) {
          self.snaps = fixedHeights && _.map(fixedHeights, function(v, k) { return k==='dense' ? v : v + 1; });
          if (self.snaps) { self.snaps.always = fixedHeights && !!(fixedHeights.pack || fixedHeights.full); }
        }
        o.browser.find('.browser-line').removeClass('last-resized');
        o.line.addClass('last-resized');
        $(this).addClass('resizing-side');
        $linesBelow = o.line.nextAll().each(function() { $(this).data('origTop', $(this).position().top); });
      },
      resize: function(e, ui) {
        var height = self.$side.outerHeight(); // for some reason ui.size.height is always behind by 1 frame
        if (self.snaps && (ui.size.height < _.max(self.snaps) || self.snaps.always)) {
          height = _.min(self.snaps, function(v) { return Math.abs(v - ui.size.height); });
          self.$side.outerHeight(height);
        }
        o.line.genoline('fixFirstLabel', true);
        self._resize(height);
        $linesBelow.each(function() {
          $(this).css('top', $(this).data('origTop') + height - ui.originalSize.height);
        });
      },
      stop: function(e, ui) {
        $('body').removeClass('row-resizing');
        $(this).removeClass('resizing-side');
        $(this).css('width', '');
        o.browser.genobrowser('recvTrackResize', o.line, o.track.n, self.$side.outerHeight());
      }
    };
    
    if (self.ruler) { opts.maxHeight = o.track.oh - paddingBordersY; }
    self.$side.resizable(opts);
    $h = self.$side.find('.ui-resizable-handle');
    $h.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
  },
  
  _initSideButtons: function() {
    var self = this,
      o = self.options;
      
    self.$removeBtn = $('<a class="remove"><img src="css/close.svg" class="icon"/></a>');
    self.$removeBtn.appendTo(self.$sideBtns).button();
    self.$removeBtn.click(function() { o.browser.genobrowser('hideTrack', o.track.n); });
    
    self.$settingsBtn = $('<a class="settings"><img src="css/cog.svg" class="icon"/></a>');
    self.$settingsBtn.appendTo(self.$sideBtns).button();
    self.$settingsBtn.click(function() { o.browser.genobrowser('editCustomTrack', o.track.n); });
    
    self._lockPackDensity = false;
    self.$lockPackBtn = $('<a class="lock-pack"><img src="css/eye.svg" class="icon"/>' +
                          '<img src="css/lock-unlocked.svg" class="icon lock"/></a>');
    self.$lockPackBtn.appendTo(self.$sideBtns).button().click(function() {
      o.browser.genobrowser('lockDensity', o.track.n, !$(this).data('pressed') ? "pack" : false);
    });
    if (o.track.lock === "pack") { self.updateLockPackBtn(true); }
    if (o.track.custom && o.track.custom.stretchHeight) { self.$lockPackBtn.hide(); }
    
    self.$sideCont.hover(function() { self.$sideBtns.addClass('hover'); }, 
                         function() { self.$sideBtns.removeClass('hover'); });
  },
  
  updateLockPackBtn: function(pressed) {
    this.$lockPackBtn.data('pressed', pressed);
    this.$lockPackBtn.toggleClass('ui-state-pressed inset-shadow', pressed);
    this.$lockPackBtn.find('.icon.lock').attr('src', 'css/lock-' + (pressed ? 'locked' : 'unlocked') + '.svg');
  },
  
  _initSideScroll: function() {
    var self = this,
      o = self.options;
    self.$scrollbarThumb = $('<div class="scrollbar-thumb"/>').appendTo(self.$scrollbar);
    self.$scrollbarThumb.draggable({
      axis: "y",
      containment: "parent",
      scroll: false,
      cursor: 'default',
      start: function() {
        o.browser.genobrowser('areaHover', false);
        $('body').addClass('track-scrolling');
      },
      drag: function(e, ui) { self._scroll(ui); },
      stop: function() {
        self.fixClipped();
        $('body').removeClass('track-scrolling');
      }
    });
    
    self.$scrollbarCorner = $('<div class="scrollbar-corner"/>').appendTo(self.$scrollbar);
  },
 
  // getter for the side element (holding track labels)
  side: function() { return this.$side; },
 
  _fixSide: function(density, bppp, force) {
    var self = this,
      o = self.options,
      $elem = self.element,
      n = o.track.n,
      $cont = self.$side.children('.subtrack-cont'),
      trackDesc = o.browser.genobrowser('option', 'trackDesc'), // always use the latest values from the browser
      densBpppMemo = [density, bppp].join('|'),
      dens, text, h;
    if ($cont.data('densBppp') === densBpppMemo && force !== true) { return; }
    $cont.find('.subtrack').remove();
    // First, draw the subtrack labels. Sometimes they are density dependent:
    if (dens = trackDesc[n] && trackDesc[n].dens && trackDesc[n].dens[density]) {
      if (dens[0][0] === 0) {
        // Labels can also change for certain bppp levels
        dens = (dens[_.sortedIndex(dens, [bppp], function(v) { return v[0]; }) - 1] || dens[0]).slice(1);
      }
      // Apply the appropriate subtrack labels for certain bppp levels
      _.each(dens, function(v) {
        v = _.isArray(v) ? v : [v];
        h = v[1] || 15;
        $('<div class="subtrack"/>').css({height: h, lineHeight: h+'px'}).html(v[0]).appendTo($cont);
      });
    } else { // sometimes they are not
      text = (trackDesc[n] && trackDesc[n].sm) || o.track.n;
      h = o.track.h;
      $cont.append($('<div class="subtrack unsized"/>').text(text));
    }
    // TODO: Next, draw the ticks for subtrack scales, which can be set by certain custom tracks.
    this._fixSideYAxisTicks(density);
    $cont.data('densBppp', densBpppMemo);
  },
 
  // fixes vertical tick elements for scales specified in o.scales on certain custom tracks
  _fixSideYAxisTicks: function(density) {
    var self = this,
      o = self.options,
      // o.scales is supposed to be an object with densities as the keys (or "_all", which is used for all densities)
      //    and each value is an array containing objects that each specify a scale
      // each scale is in the form {limits: [low, high], specialTicks: [val], yLine: false, top: pixels,
      //                            height: pixels, bottom: pixels}
      //    WHERE specialTicks and yLine are optional AND only one of bottom or height is required
      scales = o.scales._all || o.scales[density],
      $cont = self.$side.children('.subtrack-cont'),
      $scales = $cont.find('.scales'),
      scaleHtml = '<div class="scale"><span class="tick top"/><span class="tick bottom"/></div>',
      $scale, extraTicks;
   
    function format(n) {
      var log = Math.log10(Math.abs(n)),
        hasDecimal = n !== Math.round(n);
      return n === 0 || !hasDecimal ? n : n.toFixed(Math.max(-Math.floor(log) + 2, 0));
    }
   
    if (scales && !_.isArray(scales)) { scales = [scales]; }
    if (!scales || !scales.length) { $cont.find('.scale').remove(); return; }
    _.each(scales, function(scale, i) {
      // create and position the scale
      $scale = $scales.children('.scale').eq(i);
      if (!$scale.length) { $scale = $(scaleHtml).appendTo($scales); }
      $scale.css('top', (scale.top || 0) - self._scrollTop).data('top', scale.top || 0);
      if (scale.height) { $scale.css('height', scale.height); }
      else { $scale.css('bottom', scale.bottom || 0); }
      $scale.toggleClass('tiny', $scale.height() < 24);
     
      // create, position, and fill the limit ticks
      $scale.children('.top').text(format(scale.limits[1])).prepend('<span class="mark">&nbsp;</span>');
      $scale.children('.bottom').text(format(scale.limits[0])).prepend('<span class="mark">&nbsp;</span>');
     
      // create, position, and fill the special ticks and the yLineMark tick
      extraTicks = _.isArray(scale.specialTicks) ? scale.specialTicks : [];
      if (!_.isUndefined(scale.yLine) && scale.yLine !== false) { extraTicks = extraTicks.concat(scale.yLine); }
      $scale.children('.extra-tick').slice(extraTicks.length).remove();
      _.each(extraTicks, function(tick, j) {
        var $tick = $scale.children('.extra-tick').eq(i),
          position = (scale.limits[1] - tick) / (scale.limits[1] - scale.limits[0]) * 100;
        if (!$tick.length) { $tick = $('<span class="extra-tick tick"/>').appendTo($scale); }
        $tick.text(tick).prepend('<span class="mark">&nbsp;</span>');
        if (!_.isArray(scale.specialTicks) || j >= scale.specialTicks.length) {
          // yLineMark ticks are positioned above or below the line so as not to occlude the line
          if (position > 50) { $tick.css('bottom', (100 - position) + '%'); }
          else { $tick.css('top', position + '%').addClass('top'); }
        } else {
          $tick.css('top', position + '%').addClass('mid');
        }
      });
    });
    $scales.children('.scale').slice(scales.length).remove();
  },
 
  // public resize function that updates the entire UI accordingly.
  resize: function(height, animCallback) {
    var $elem = this.element,
      o = this.options,
      alsoEraseStretchedTiles = function() {},
      paddingBordersY = this.$side.outerHeight() - this.$side.height();
    // can pass callback==true to animate without a callback
    if (!_.isFunction(animCallback) && animCallback) { animCallback = function() {}; }
    if (o.track.custom && o.track.custom.stretchHeight) {
      alsoEraseStretchedTiles = function() {
        $elem.find('.tile-custom canvas').each(function() {
          if (this.unscaledHeight() < height) { 
            this.unscaledHeight(height);
            $(this).trigger('render');
          }
        });
      };
    }
    // this._resize(height, animCallback);
    if (animCallback) {
      this._resize(height, function() { alsoEraseStretchedTiles(); animCallback(); });
      this.$side.animate({height: height - paddingBordersY}, o.lineFixDuration);
    } else {
      this._resize(height);
      this.$side.outerHeight(height);
      alsoEraseStretchedTiles();
    }
  },
 
  // internal resize handler, used by the resizable side handle, does not update the side height.
  _resize: function(height, callback) {
    var o = this.options,
      $elem = this.element,
      bppps = this.bppps();
    if (this.ruler) {
      if (height < this.$side.resizable('option', 'minHeight') + 3) { $elem.addClass('ruler-collapsed'); }
      else { $elem.removeClass('ruler-collapsed'); }
    }
    o.track.h = height;
    o.browser.genobrowser('densityOrder', o.track.n, height, bppps);
    this.fixTiles();
    this.fixClipped();
    this.$side.find('.scale').each(function() { $(this).toggleClass('tiny', $(this).height() < 24); });
    this.$sideBtns.toggleClass('tiny', height < 30);
    if (height < 30 && this.$lockPackBtn.data('pressed')) { this.$lockPackBtn.click(); }
    if (_.isFunction(callback)) {
      this.element.animate({height: height}, o.lineFixDuration, callback).css('overflow', 'visible');
    } else { this.element.height(height); }
  },
 
  // internal scroll handler, used by the side scrollbar.
  _scroll: function(ui) {
    var self = this,
      $elem = self.element,
      o = self.options,
      scrollBarCornerHeight = 6,
      pos = ui.position.top,
      availSpace = o.track.h - 1;
    // Should be preset by _fixScrollSide() below, but, just in case.
    self._scrollThumbHeight = self._scrollThumbHeight || self.$scrollbarThumb.outerHeight();
    self._scrollTop = Math.round(pos / (self._scrollBarHeight - self._scrollThumbHeight) * 
                                 (self._maxTileHeight - availSpace));
    self.fixClipped(true);
    $elem.toggleClass('clipped-top', self._scrollTop !== 0);
    $elem.find('.tdata:not(.dens-dense),.labels').css('top', -self._scrollTop);
    self.$side.find('.scale').each(function() {
      $(this).css('top', $(this).data('top') - self._scrollTop);
    });
    // Show a corner for the top edge of the scrollbar if it's not glued to the top of the track
    self.$scrollbarCorner.toggle(self._scrollBarHeight < o.track.h - scrollBarCornerHeight - 1 && 
                                 self._scrollTop > scrollBarCornerHeight)
  },
 
  // what densities can this track display for the given bppp (tile zoom level)?
  _availDensities: function(bppp) {
    var self = this,
      o = self.options;
    self.availDensities = {};
    _.each(o.bppps, function(bppp) {
      var densities = [];
      for (var i = 0; i < o.track.s.length; i++) {
        var v = o.track.s[i];
        if (!_.isArray(v)) { v = [v]; }
        if (v[1] && bppp > v[1]) { continue; }
        if (v[2] && bppp <= v[2]) { continue; }
        densities.push(v[0]);
      }
      self.availDensities[bppp] = densities;
    });
    return self.availDensities;
  },
 
  // at the given bppp, what is the best density to display? Requires calling up to the browser
  // level for a densityOrder calculation on all lines showing this track.
  _bestDensity: function(bppp) {
    var densities = this.availDensities[bppp],
      densityOrder = this.options.browser.genobrowser('densityOrder', this.options.track.n);
    return _.min(densities, function(d) { return densityOrder[d]; });
  },
 
  updateDensity: function() {
    var self = this,
      o = self.options,
      $elem = self.element,
      topBppp = self.bppps().top;
    var bestDensity = self._bestDensity(topBppp);
    // Fix side labels (e.g. for subtracks) for the best density
    self._fixSide(bestDensity, topBppp);
    // Set the class that shows the best bppp (and hide the rest)
    $elem.find('.tile').removeClass('bppp-top').filter('.bppp-'+classFriendly(topBppp)).addClass('bppp-top');
    // Set the best density and trigger events on these tiles
    $elem.find('.tile-full').children('.tsc').children('.tdata,.area.label,.labels').each(function() {
      var $this = $(this),
        isBest = $this.hasClass('dens-'+bestDensity);
      $this.toggleClass('dens-best', isBest);
      if (isBest) { $this.trigger('bestDensity'); }
    });
    // Finally, fix clipping indicators
    self.fixClipped();
  },
 
  // returns a (possibly cached) object listing the nearest bppps to the current zoom (in `nearest:`),
  // whether the bppp level is for background caching, in `cache:` (relevant only for <img> tiles),
  // and what the topmost bppp level is, in `top:`.
  _nearestBppps: function(zoom) {
    var o = this.options,
      bppps = { nearest: [o.bppps[0]], preload: [], top: o.bppps[0] },
      possibleBppps = this.ruler ? this.sliderBppps : o.bppps,
      l = possibleBppps.length,
      found = false,
      shrinkableWindow, getNext;
    for (var i = 0; i < l; i++) {
      var zoomDiff = zoom - possibleBppps[i];
      if (zoomDiff > 0) {
        shrinkableWindow = (possibleBppps[i + 1] || possibleBppps[i] / 3);
        // Only also include the *next* zoomed-out level if the difference in zoom levels is close enough
        // getNext == 0 if we don't include it; 1 if we do.
        getNext = 0 + (zoomDiff < shrinkableWindow);
        bppps.nearest = possibleBppps.slice(Math.max(i - 2 + getNext, 0), i + getNext);
        if (getNext) { bppps.preload = [false, zoomDiff > shrinkableWindow / 2]; }
        bppps.top = bppps.preload[1] ? bppps.nearest[0] : bppps.nearest.slice(-1)[0];
        found = true;
        break;
      }
    }
    if (!found) {
      bppps.nearest = possibleBppps.slice(-2);
      bppps.top = possibleBppps.slice(-1)[0];
    }
    bppps.topFormatted = this._bpppFormat(bppps.top);
    return (this._bppps = bppps);
  },
 
  bppps: function(forceRecalc) {
    var zoom = this.options.browser.genobrowser('zoom');
    return (forceRecalc || !this._bppps) ? this._nearestBppps(zoom) : this._bppps;
  },
 
  fixTiles: function(forceRepos) {
    var self = this,
      $elem = self.element,
      o = self.options;
    
    if (!o.browser.genobrowser('tileFixingEnabled')) { return; }
    
    var pos = o.line.genoline('getPos'),
      zoom = o.browser.genobrowser('zoom'),
      availWidth = o.browser.genobrowser('lineWidth'),
      allTilesNeeded = [],
      missingTiles = [],
      prevTop = this._bppps && this._bppps.top,
      bppps = this.bppps(forceRepos),
      $recyclableTiles, recyclableTiles;
    
    // Based on our current zoom and position, figure out which tiles we need, and which are missing
    _.each(bppps.nearest, function(bppp, i) {
      var bpPerTile = o.tileWidth * bppp,
        tileId = floorHack((pos - availWidth * bppp * (bppps.preload[i] ? 0 : 0.75)) / bpPerTile) * bpPerTile + 1,
        tilesNeeded = [tileId],
        rightMargin = pos + (bppps.preload[i] ? 1 : 1.75) * availWidth * bppp,
        bestDensity = self._bestDensity(bppp);
      while ((tileId += bpPerTile) < rightMargin) { tilesNeeded.push(tileId); }
      _.each(tilesNeeded, function(tileId) {
        var repos = false, $t = $('#' + self._tileId(tileId, bppp));
        if ($t.length) { 
          allTilesNeeded.push($t.get(0));
          if (forceRepos) { self._reposTile($t, tileId, zoom, bppp); }
        } else { 
          missingTiles.push([tileId, bppp, bestDensity, bppps.preload[i], bppps.top]); 
        }
      });
    });
    
    // Some unneeded tiles are blank, and can be deleted.
    // Some unneded tiles will contain prebuilt custom tile HTML, and can be recycled into new tiles.
    // This avoids the overhead of DOM element creation and destruction, which is expensive.
    $elem.children('.tile.tile-blank').not(allTilesNeeded).remove();
    $recyclableTiles = $elem.children('.tile').not(allTilesNeeded);
    recyclableTiles = $recyclableTiles.get();
    
    // For each missing tile, see if we can fill it with a recycled tile, otherwise add a new one.
    _.each(missingTiles, function(tileSpec) {
      var tileId = tileSpec[0],
        bppp = tileSpec[1],
        $t, oldTile;
      if (recyclableTiles.length && tileId > 0 && tileId < o.genomeSize) {
        oldTile = recyclableTiles.pop();
        $t = self._recycleTile.apply(self, [oldTile].concat(tileSpec));
      } else {
        $t = self._addTile.apply(self, tileSpec);
      }
      self._setTileZIndex($t, bppp);
      self._reposTile($t, tileId, zoom, bppp);
    });
    
    // FIXME Previously we didn't ever recycle tiles. This is the alternative to the above chunk.
    // _.each(missingTiles, function(tileSpec) {
    //   var $t = self._addTile.apply(self, tileSpec);
    //   self._setTileZIndex($t, tileSpec[1]);
    //   self._reposTile($t, tileSpec[0], zoom, tileSpec[1]);
    // });
    
    // Delete all the remaining unneeded tiles that we weren't able to recycle.
    $(recyclableTiles).remove();
    
    if (prevTop && prevTop != bppps.top) { self.updateDensity(); }
    this._fixSideClipped();
  },
 
  _addTile: function(tileId, bppp, bestDensity, cached, topBppp) {
    var self = this,
      o = self.options,
      $elem = self.element,
      $d = $.mk('div').attr('class', 'tile' + (bppp == topBppp ? ' bppp-top' : '')),
      bpPerTile = o.tileWidth * bppp,
      tileType = self._tileType(tileId, bppp),
      densities = self.availDensities[bppp],
      $tileBefore = $('#' + self._tileId(tileId - bpPerTile, bppp)),
      $sc;

    $d.appendTo(self.element);
    $d.attr('id', self._tileId(tileId, bppp)).data({bppp: bppp, tileId: tileId});
    $d.data({prevTileId: self._tileId(tileId - bpPerTile, bppp), nextTileId: self._tileId(tileId + bpPerTile, bppp)});
    if ($.support.touch) { self._tileTouchEvents($d); }
    else { $d.mousemove({self: self}, self._tileMouseMove).mouseout({self: self}, self._tileMouseOut); }

    if (tileType.blank) { $d.addClass('tile-blank').addClass('tile-off-' + (tileType.left ? 'l' : 'r')); }
    else if (tileType.custom) { self._customTile($d, tileId, bppp, bestDensity); }
    else { self._rulerTile($d, tileId, bppp); } // tileType.ruler === true
    return $d;
  },
  
  _recycleTile: function(tileDiv, tileId, bppp, bestDensity, cached, topBppp) {
    var self = this,
      o = self.options,
      $d = $(tileDiv),
      bpPerTile = o.tileWidth * bppp,
      zoom = o.browser.genobrowser('zoom'),
      end = tileId + bpPerTile,
      tileType = self._tileType(tileId, bppp),
      densities = self.availDensities[bppp],
      $tileBefore = $('#' + self._tileId(tileId - bpPerTile, bppp)),
      $sc;
    
    $d.attr('id', self._tileId(tileId, bppp)).data({bppp: bppp, tileId: tileId});
    $d.data({prevTileId: self._tileId(tileId - bpPerTile, bppp), nextTileId: self._tileId(tileId + bpPerTile, bppp)});
    
    if (tileType.custom) { 
      $d.attr('class', 'tile tile-custom tile-full tile-loaded bppp-' +classFriendly(bppp));
      $d.toggleClass('bppp-top', bppp == topBppp);
      $sc = $d.children('.tile-scroll-cont');
      _.each(o.track.s, function(density) {
        var $c = $sc.children('.tdata.dens-' + density),
          $lc = $sc.children('.labels.dens-' + density);
        if (density != 'dense') { $c.css('top', -self._scrollTop); }
        $c.data('areas', null).data('renderingCallbacks', []);

        $c.attr('class', 'tdata unrendered dens-' + density); // Reset all the extra classes, e.g. too-many, no-areas, etc.
        // TODO: any value to erasing vs just setting unrendered
        $c.unbind('render', self._customTileRender);
        $c.bind('render', {start: tileId, end: end, density: density, self: self, custom: o.track.custom}, self._customTileRender);
        $c.add($lc).toggleClass('dens-best', density == bestDensity);
      });
      $sc.children('.tdata.dens-best').trigger('render');
    } else {  // tileType.ruler must be true
      $d.attr('class', 'tile tile-ruler bppp-'+classFriendly(bppp)).data('bppp', bppp);
      $d.toggleClass('bppp-top', bppp == topBppp);
      self._drawRulerCanvasTicksAndBands($d, tileId, bppp, zoom);
    } 
    
    return $d;
  },

  _setTileZIndex: function($t, bppp) {
    // NOTE that the following assumes nobody would ever horizontally scroll 50,000 tile widths before zooming in/out
    var baseZIndex = _.indexOf(this.sliderBppps, bppp) * 100000 + 50000,
      $prevTile = $('#' + $t.data('prevTileId')),
      $nextTile = $('#' + $t.data('nextTileId')),
      zIndex;
    if ($prevTile.length) { zIndex = $prevTile.data('zIndex') + 1; }
    else if ($nextTile.length) { zIndex = $nextTile.data('zIndex') - 1; }
    else { zIndex = baseZIndex; }
    $t.addClass('tile-show').data('zIndex', zIndex).css('z-index', zIndex);
  },
 
  // Repositions tiles in the X-direction after any zooming, origin change, etc.
  // Tile data's Y-position is set by the _scroll handler above (or during creation, from self._scrollTop)
  _reposTile: function($tile, tileId, zoom, bppp) {
    var o = this.options,
      left = (tileId - o.line.genoline('option', 'origin')) / zoom,
      width = Math.ceil(o.tileWidth * bppp / zoom);
    // Absolutely ugly hack to preclude strange re-painting bug on Chrome that only occurs for the tile just left of 0
    // at the highest zoom level. It's a blank tile, so it doesn't matter that we stretch it a teensy bit.
    if (left === -o.tileWidth && zoom === o.bppps[0]) { width += 0.1; }
    $tile.css('left', left);
    $tile.css('width', width);
   
    if (this.ruler && bppp <= o.ntsBelow[0]) {
      $tile.find('svg').each(function() {
        var width = $tile.width() + 'px';
        this.setAttributeNS(null, "width", width);
        this.firstChild.setAttributeNS(null, "y", "11");
      });
    }
  },
 
  // Shows orange clipping indicators if any of the best density tiles have data cut off at the bottom
  fixClipped: function(dontFixScrollbar) {
    var self = this,
      $elem = self.element,
      o = self.options,
      sideClipped = false,
      heights = [0];
    if (o.track.custom && o.track.custom.stretchHeight) { return; }
    $elem.find('.tile-full').each(function() {
      var $t = $(this),
        best = $t.children('.tsc').children('.tdata.dens-best:not(.loading):not(.stretch-height)').get(0),
        h = best && (best.tagName == 'CANVAS' ? best.unscaledHeight() : (best.naturalHeight || best.height)) || 0,
        clippedBottom = h > self._scrollTop + o.track.h;
      $t.data('idealHeight', h);
      $t.toggleClass('clipped-bottom', clippedBottom);
    });
    self._fixSideClipped(dontFixScrollbar);
  },
 
  // Shows the orange clipping indicator on the side panel if any tiles in view have the clipping indicator
  _fixSideClipped: function(dontFixScrollbar) {
    var bppps = this.bppps(),
      o = this.options,
      pos = o.line.genoline('getPos'),
      zoom = o.browser.genobrowser('zoom'),
      bpWidth = o.browser.genobrowser('bpWidth'),
      tileBpWidth = bppps.top * o.tileWidth,
      clipped = this._scrollTop !== 0,
      heights = [o.track.h - 1 + this._scrollTop];
    this.element.children('.clipped-bottom.bppp-'+classFriendly(bppps.top)).each(function() {
      var tileId = $(this).data('tileId');
      if (tileId > pos - tileBpWidth && tileId < pos + bpWidth) { 
        clipped = true;
        heights.push($(this).data('idealHeight') + 2);
      }
    });
    this._maxTileHeight = Math.max.apply(Math, heights);
    this.$side.toggleClass('clipped', clipped);
    this.$side.toggleClass('clipped-bottom', clipped);
    if (!dontFixScrollbar && clipped) { this._fixSideScroll(); }
  },
  
  _fixSideScroll: function() {
    var o = this.options,
      availSpace = o.track.h - 1,
      // See _fixSideYAxisTicks() for how o.scales is defined
      scaleHeights = _.flatten(_.map(o.scales, function(sc) {
        return _.map(sc, function(s) { 
          return _.isUndefined(s.bottom) ? s.top + s.height : availSpace - s.bottom; 
        });
      })),
      maxScaleHeight = Math.max.apply(Math, [0].concat(scaleHeights)),
      scrollBarHeight, scrollThumbHeight, scrollThumbFudge, thumbTop;
    this.$scrollbar.css('top', maxScaleHeight);
    this._scrollBarHeight = scrollBarHeight = availSpace - maxScaleHeight;
    this.$side.toggleClass('scrolled', this._scrollTop !== 0);
    scrollThumbHeight = Math.ceil(scrollBarHeight * scrollBarHeight / this._maxTileHeight);
    this.$scrollbarThumb.outerHeight(scrollThumbHeight);
    // The thumb has a min-height set so that it stays big enough to grab. So we have to re-measure it
    this._scrollThumbHeight = scrollThumbHeight = this.$scrollbarThumb.outerHeight();
    thumbTop = Math.round(this._scrollTop / (this._maxTileHeight - availSpace) * 
                          (scrollBarHeight - scrollThumbHeight));
    this.$scrollbarThumb.css('top', thumbTop);
  },
 
  _tileTouchEvents: function($tile) {
    var self = this;
    $tile.bind('touchstart', {self: self}, function(e) {
      if (e.originalEvent.touches.length > 1) { return; }
      e.pageX = e.originalEvent.touches[0].pageX;
      e.pageY = e.originalEvent.touches[0].pageY;
      self._tileMouseMove.call(this, e);
    });
  },

  // For custom tracks, it is more performant to perform hover target calculation
  // in JS directly on the list of areas rather than constantly add/remove many invisible
  // DOM elements with their own event handling.
  _tileMouseMove: function(e) {
    var $targ = $(e.target),
      $tile = $(this),
      $tdata = $targ.closest('.tdata'),
      nextTileId = $tile.data('nextTileId'),
      self = e.data.self,
      o = self.options,
      prev = o.browser.genobrowser('areaHover'),
      density = $tdata.data('density'),
      $nextTdata, areas, ratio, bppp;
    
    function cancelAreaHover() { !$targ.is('.area') && o.browser.genobrowser('areaHover', false); }
    
    if ($('body').hasClass('dragging')) { return; }
    if (!$tdata.length || !$tdata.hasClass('dens-best')) { cancelAreaHover(); return; }
    
    // Now we tally up the areas we need to check before proceeding.
    areas = $tdata.data('areas') || [];
    bppp = $tdata.data('bppp');
    ratio = bppp / o.browser.genobrowser('zoom');
    // We need $nextTdata, the corresponding .tdata for the right-adjacent tile, because we also need to check
    // that tile for areas where the size of their text label hangs them over into this tile.
    $nextTdata = $('#' + nextTileId + '>div>.tdata.dens-' + density).eq(0);
    areas = areas.concat(_.compact(_.map($nextTdata.data('areas') || [], function(v, i) {
      // If the label width doesn't hang over the left side, we don't care about it
      if (_.isUndefined(v[10]) || v[0] * ratio - v[10] > 0) { return false; };
      var arr = v.slice();
      arr.i = i; // need to save the original i, because it's used by the areaIndex--see below
      // FIXME: Should refactor area data from arrays --> POJO's. Adding properties to arrays is pretty gross.
      arr.hrefHash = v.hrefHash;
      arr[0] += o.tileWidth;
      arr[2] += o.tileWidth;
      return arr;
    })));
    if (!areas.length) { cancelAreaHover(); return; }
    
    var offset = $tile.offset(),
      x = e.pageX - offset.left,
      y = e.pageY - offset.top + self._scrollTop;
    for (var i = 0; i < areas.length; i++) {
      var v = areas[i], 
        left = _.isUndefined(v[10]) ? v[0] : (v[0] * ratio - v[10]),  // include possible text label width
        areaId;
      if (x > left && x < v[2] * ratio && y > v[1] && y < v[3]) {
        if (o.track.n + '.hrefHash.' + v.hrefHash !== prev) {
          areaId = _.isUndefined(v.i) ? ($tile.attr('id') + '.' + i) : (nextTileId + '.' + v.i);
          o.browser.genobrowser('areaHover', [o.track.n, bppp, density, 'hrefHash', v.hrefHash], areaId);
        }
        return;
      }
    }
    if (!$targ.is('.area')) { o.browser.genobrowser('areaHover', false); }
    return;
  },
 
  _tileMouseOut: function(e) {
    var $targ = $(e.target),
      $tdata = $targ.closest('.tdata'),
      self = e.data.self,
      $relTarget = $(e.relatedTarget);
    if (!$tdata.length) { return; }
    if (!$relTarget.closest('.tile').length) { self.options.browser.genobrowser('areaHover', false); }
  },
 
  _areaMouseOver: function(e) {
    var d = e.data,
      o = d.self.options;
    o.browser.genobrowser('areaHover', [o.track.n, d.bppp, d.density, 'hrefHash', d.hrefHash], d.areaId);
  },
 
  fixClickAreas: function() {
    var self = this,
      o = this.options,
      $elem = self.element,
      nearest = this.bppps().nearest,
      densityOrder = o.browser.genobrowser('densityOrder', o.track.n);
    if (!o.track.m || !o.track.m.length) { return; }
    _.each(o.track.m, function(density) {
      _.each(nearest, function(bppp) {
        var densities = self.availDensities[bppp],
          bestDensity = self._bestDensity(bppp);
        if (!_.include(densities, density)) { return; }
        $elem.find('.bppp-'+classFriendly(bppp)+' .tdata.dens-'+density+'.no-areas').each(function(){
          self._addClickableAreas(this, bppp, density, bestDensity);
        }).removeClass('no-areas');
      });
    });
  },
 
  _areaTipTipHtml: function(tipTipData, title, withHiddenFields) {
    var $tipTipDiv = $('<div/>'),
      $name = $('<div class="name"/>').appendTo($tipTipDiv),
      $table = $('<table/>').appendTo($tipTipDiv),
      $tbody = $('<tbody/>').appendTo($table),
      keys = _.keys(tipTipData),
      hiddenKeys = _.filter(_.keys(tipTipData), function(k) { return k[0] == '.'; }),
      $prevDescTr, hiddenKeys;
    
    if (withHiddenFields === true) { 
      // If we're *showing* hidden fields, *hide* fields that correspond to the undotted fieldname
      keys = _.difference(keys, _.map(hiddenKeys, function(k) { return k.replace(/^\.+/, ''); }));
    } else {
      keys = _.difference(keys, hiddenKeys);
    }
    
    _.each(keys, function(k) {
      var v = tipTipData[k],
          $tr;
      if (/^description$|^type$|refseq summary/i.test(k)) {
        $prevDescTr = $tbody.children('.desc');
        if ($prevDescTr.length) { $tr = $('<tr class="desc"/>').insertAfter($prevDescTr); }
        else { $tr = $('<tr class="desc"/>').prependTo($tbody); }
        if (v.length > 300) { v = v.substr(0, 300).replace(/\s+\S+$/, '') + '...'; }
        $('<td colspan="2"/>').text(v).appendTo($tr);
      } else {
        k = k.replace(/^\.+/, '');
        $tr = $('<tr/>').appendTo($tbody);
        if (v == '---') {
          $('<td colspan="2" class="fields-header"/>').text(k).appendTo($tr);
        } else {
          $('<td class="field" width="45%"/>').text(k).appendTo($tr);
          $('<div/>').text(v).appendTo($('<td class="value" width="55%"/>').appendTo($tr));
        }
      }
    });
    if (title) { $name.text(title); }
    return $tipTipDiv;
  },
  
  _areaTipTipEnter: function(callback) {
    var self = $(this).data('genotrack'),
      href = $(this).attr('href'),
      tiptipData = $(this).data('tiptipData'),
      oldTitle = $(this).data('title'),
      $tipTipDiv;
    if ($('body').hasClass('dragging')) { return callback(false); }
    if (tiptipData) {
      $tipTipDiv = self._areaTipTipHtml(tiptipData, oldTitle);
      callback($tipTipDiv);
    }
  },
  
  // Default click handler for areas with data but no href.
  // Creates a new window that displays all data about the area, generated from its tipTipData.
  _areaDefaultClick: function(e) {
    var self = this,
      $a = $(e.target).closest('a.area'),
      title = $a.data('title') || $a.attr('title'),
      tipTipData = $a.data('tiptipData'),
      cssUrl = utils.dirname(window.location.pathname) + "css/item-data.css";
      headHtml = '<!DOCTYPE html>\n<html><head><link rel="stylesheet" type="text/css" href="' + cssUrl + '"/></head>',
      bodyHtml = '<body>' + self._areaTipTipHtml(tipTipData, title, true).html() + '</body></html>';
    
    window.open().document.write(headHtml + bodyHtml);
    e.preventDefault(); // We shouldn't execute the placeholder javascript: hrefs
  },
 
  makeAnchor: function($tile, area, bppp, density, flags) {
    var bestDensity = this._bestDensity(bppp),
      o = this.options,
      custom = o.track.custom,
      defaultColor = (custom && custom.opts.color) || '0,0,0',
      tipTipOptions = {
        async: true,
        delay: 400,
        enter: this._areaTipTipEnter,
        allowOverlayX: true
      },
      hash = shortHash(area[5]),
      $scrollCont = $tile.children('.tsc'),
      scaleToPct = 80 / o.tileWidth,
      leftPadPct = 20,
      $a = $.mk('a').addClass('area dens-'+density+' href-hash-'+hash).attr('title', area[4]),
      ratio = o.browser.genobrowser('zoom') / bppp,
      // area[10], if set, is the width of the text label attached to the left side of the area.
      leftPx = (area[0] - (_.isUndefined(area[10]) ? 0 : area[10] * ratio)),
      leftPct = leftPx * scaleToPct + leftPadPct + '%',
      href = (custom ? '' : this.baseURL) + area[5];
    
    $a.attr('href', href).attr('target', '_blank');
    // If the href is a placeholder (starts with javascript:) execute a default handler that spits data into a new window
    if ((/^javascript:/).test(href)) { $a.click(_.bind(this._areaDefaultClick, this)); }
    $a.css({top: area[1] - this._scrollTop, height: area[3] - area[1] - 2});
    
    // FIXME: the following branch is deprecated now that all labels are drawn with _drawAreaLabels() to <canvas>
    if (flags.label) {
      $a.css({right: leftPct + '%', color: 'rgb(' + (area[7] || defaultColor) + ')'}).addClass('label');
      if (area[8]) { $a.html(area[8]); } else { $a.text(area[4]); }
      $a.mouseover({
        self: this, 
        bppp: bppp, 
        density: density, 
        hrefHash: hash, 
        areaId: $tile.attr('id') + '.' + flags.i
      }, this._areaMouseOver);
    } else {
      $a.addClass('rect').css({left: leftPct, width: ((area[2] - leftPx) * scaleToPct) + '%'});
      if (flags.flashme) {
        $a.addClass('flashing').effect("pulsate", {times: 2}, 1000, function() {
          $(this).fadeOut(300, function() { $(this).removeClass('flashing'); });
        });
      }
      if (flags.hover) { $a.addClass('hover'); }
      if (flags.tipTipActivated) { tipTipOptions.startActivated = true; }
    }
    $a.data('genotrack', this).tipTip(tipTipOptions);
    if (area[9]) { $a.data('tiptipData', area[9]); }
    return $a.data('hrefHash', hash).toggleClass('dens-best', density == bestDensity).appendTo($scrollCont);
  },
 
  _drawAreaLabels: function($scrollCont, bppp, density, areas) {
    //return; //FIXME
    var self = this,
      o = this.options,
      custom = o.track.custom;

    if (!custom.expectsAreaLabels) { return; }
      
    var fillBg = $(self.element).is(':nth-child(even)') ? '#f3f6fa' : '#ffffff',
      zoom = o.browser.genobrowser('zoom'),
      bestDensity = self._bestDensity(bppp),
      $tile = $scrollCont.parent(),
      $tdata = $scrollCont.children('.tdata.dens-' + density),
      overhangRatio = 0.25,
      canvasWidth = $tile.width() * (1 + overhangRatio),
      leftOverhang = $tile.width() * overhangRatio,
      canvasHeight = $tdata.height(),
      canvasAttrs = {"class": 'labels dens-' + density, width: canvasWidth, height: canvasHeight},
      $c = $scrollCont.children('canvas.labels').eq(0);
      
    if (!areas) { areas = $tdata.data('areas'); }
    $c.css('height', canvasHeight).css('top', -this._scrollTop);
    
    custom.renderAreaLabels($c.get(0), areas, canvasHeight, canvasWidth, overhangRatio, bppp, zoom, fillBg, function(renderRes) {
      // If the renderer added a textWidth to the area, save that in our area data so it can be used by `_tileMouseMove`
      // The areas must be modified directly (instead of reassigning the whole array) to avoid breaking the areaIndex
      if (renderRes.areas && $tdata.data('areas') && renderRes.areas.length == $tdata.data('areas').length) { 
        _.each($tdata.data('areas'), function(area, i) { area[10] = renderRes.areas[i][10]; });
      }
      $c.removeClass('to-erase').toggleClass('dens-best', density == self._bestDensity(bppp));
    });
  },
 
  redrawAreaLabels: function() {
    var self = this,
      $elem = self.element,
      o = self.options;
    $elem.find('.labels').each(function() {
      var $scrollCont = $(this).parent(),
        density = $(this).data('density'),
        $tdata = $scrollCont.children('.tdata.dens-' + density);
      self._drawAreaLabels($scrollCont, $tdata.data('bppp'), density);
    });
  },
  
  _areaDataLoad: function(data, statusText, jqXHR) {
    // NOTE: this is used as an AJAX callback, so this/self must be reobtained from the jqXHR object
    var self = jqXHR._self,
      o = self.options,
      $scrollCont = $(jqXHR._appendTo),
      $tile = $scrollCont.parent(),
      tileId = $tile.attr('id'),
      $tdata = $scrollCont.children('.tdata.dens-'+jqXHR._density);
   
    function createAreaLabels(e) {
      if (jqXHR._custom.noAreaLabels) { return; }
      self._drawAreaLabels($scrollCont, jqXHR._bppp, jqXHR._density, $tdata.data('areas'));
    };
   
    // Areas are stored in a global index, so that mousing over an area in one tile can retrieve
    // areas with a similar name/hrefHash that must also be highlighted.
    // See $.ui.genobrowser's .areaHover() for how it is traversed during mouseover.
    // Add to global area index: areaIndex[track][bppp][density]["hrefHash"|"name"][hrefHash|name][tileId][i] = true
    // FIXME: the global area index can get very big over time; as of now, it is never pruned.
    _.each(data, function(v, i) {
      var index = jqXHR._areaIndex,
        keys = [o.track.n, jqXHR._bppp, jqXHR._density],
        indexBy = {hrefHash: shortHash(v[5] || ''), name: (v[4] || '').toLowerCase()};
      v.hrefHash = indexBy.hrefHash;
      _.each(keys, function(k) {
        if (!index[k]) { index[k] = {}; }
        index = index[k];
      });
      if (!index.hrefHash) { index.hrefHash = {}; index.name = {}; }
      _.each(['hrefHash', 'name'], function(by) {
        var key = indexBy[by];
        if (!index[by][key]) { index[by][key] = {}; }
        if (!index[by][key][tileId]) { index[by][key][tileId] = {}; }
        index[by][key][tileId][i] = true;
      });
    });
    $tdata.data('areas', data).data('bppp', jqXHR._bppp).data('density', jqXHR._density).removeClass('areas-loading');
   
    if (jqXHR._custom) {
      $tdata.one('bestDensity', createAreaLabels);
      if (jqXHR._density == jqXHR._bestDensity) { $tdata.trigger('bestDensity'); }
    }
    if (--self.areaLoadCounter === 0) { $(jqXHR._self.element).trigger('areaload', jqXHR._bestDensity); }
  },
 
  _addClickableAreas: function(tdataElem, bppp, density, bestDensity) {
    var self = this,
      o = self.options,
      tagName = tdataElem.tagName.toLowerCase(),
      $tdata = $(tdataElem),
      areaData, edata, mockJqXHR;
    self.areaLoadCounter++;
    $tdata.addClass('areas-loading');
    self.baseURL = self.baseURL || o.ucscURL.replace(/[^\/]+$/, '');
    function beforeSend(jqXHR) {
      $.extend(jqXHR, {
        _appendTo: tdataElem.parentNode,
        _self: self,
        _bppp: bppp,
        _bestDensity: bestDensity,
        _density: density,
        _areaIndex: o.browser.genobrowser('areaIndex')
      });
    }
   
    if (o.track.custom.areas && (areaData = o.track.custom.areas[tdataElem.id])) {
      // For <canvas> tiles on custom tracks, we should already have this info in o.track.custom.areas
      mockJqXHR = {_custom: o.track.custom};
      beforeSend(mockJqXHR);
      self._areaDataLoad(areaData, '', mockJqXHR);
    }
  },
 
  // Determines if this tile will be (1) blank (2) from a custom track or (3) part of a ruler
  // Returns a simple object describing the tile type and any additional qualifiers
  _tileType: function(tileId, bppp) {
    var o = this.options;
    if (tileId < 0 || tileId > o.genomeSize) { return {blank: true, left: tileId < 0}; }
    if (this.ruler) { return {ruler: true}; }
    if (o.track.custom) { return {custom: true}; }
    return {};
  },
 
  _tileSrc: function(tileId, bppp, density) {
    var o = this.options,
      bF = this._bpppFormat(bppp),
      imgName = pad(tileId, 10) + '.png';
    if (bppp < o.subdirForBpppsUnder) { imgName = imgName.substr(0, 4) + '/' + imgName.substr(4); }
    var ret = {
      full: this.ruler ? 'ideograms/'+bF+'/'+imgName : o.track.n+'/'+bF+'_'+density+'/'+imgName,
      bpppFormat: bF
    };
    return ret;
  },
 
  _bpppFormat: function(bppp) { return this.options.bpppFormat(bppp); },
 
  _tileId: function(tileId, bppp) {
    return this.uniqId + '-tile-' + bppp.toString().replace('.', '-') + '-' + tileId;
  },
 
  _rulerTile: function($t, tileId, bppp) {
    var self = this,
      o = self.options,
      bpPerTile = bppp * o.tileWidth,
      zoom = o.browser.genobrowser('zoom'),
      $c;
      
    $t.addClass('tile-ruler bppp-'+classFriendly(bppp)).data('bppp', bppp);
    $c = $.mk('canvas').addClass('ticks').prependTo($t);
    $c.attr('id', 'ticks-' + self.uniqId + '-' + self._customCanvasCounter++);
    $c.get(0).unscaledHeight(o.track.h);

    self._drawRulerCanvasTicksAndBands($t, tileId, bppp, zoom);
   
    // FIXME: this should be drawn instead on the .ticks <canvas> above using `.renderSequence()` in the CustomTrack
    return $t;
    if (bppp <= o.ntsBelow[0]) {
      var showNtText = bppp <= o.ntsBelow[1],
        canvasHeight = (showNtText ? 12 : 3) + (o.chrBands ? 1 : 0), // with bands, we need an extra pixel
        canvasAttrs = {width: o.tileWidth, height: canvasHeight, "class": "ntdata"};
      $t.addClass('tile-ntdata tile-loaded');
      $t.toggleClass(o.chrBands ? 'tile-overlay-ntdata' : 'tile-big-ntdata', showNtText);
      if (o.chrBands && showNtText) { $t.data('zIndex', 101); } // if we have bands, draw it on top of the bands.
      o.browser.genobrowser('getDNA', tileId, tileId + bpPerTile, self._ntSequenceLoad, {
        _c: $.mk('canvas').canvasAttr(canvasAttrs).css('height', canvasHeight).appendTo($t),
        _d: showNtText && $.mk('div').addClass('nts').appendTo($t),
        _w: Math.ceil(o.tileWidth * bppp / zoom),
        _l: bpPerTile,
        _self: self
      });
    }
  },
 
  _drawRulerCanvasTicksAndBands: function($t, tileId, bppp, zoom) {
    //return; //FIXME
    var self = this,
      o = self.options,
      track = o.track,
      bpPerTile = bppp * o.tileWidth,
      canvasHeight = o.track.h,
      canvasWidth = bppp / zoom * o.tileWidth,
      $c = $t.children('canvas.ticks').eq(0),
      canvasAttrs = {width: canvasWidth, height: canvasHeight, "class": "ticks"};
      
    $c.css('height', canvasHeight);
    var renderOpts = {
      canvasWidth: canvasWidth,
      drawChrLabels: bppp <= o.bpppNumbersBelow[0],
      drawTicks: bppp <= o.bpppNumbersBelow[1],
      drawIdeograms: zoom > o.ideogramsAbove,
      offsetForNtText: !o.chrBands && bppp <= o.ntsBelow[1]
    };
    
    track.custom.render($c.get(0), tileId, tileId + bpPerTile, renderOpts, function() {
      $t.addClass('tile-loaded');
    });
  },
 
  redrawRulerCanvasTicksAndBands: function() {
    var self = this,
      $elem = self.element,
      o = self.options,
      zoom = o.browser.genobrowser('zoom');
    $elem.children('.tile-ruler').each(function() {
      var $t = $(this);
      self._drawRulerCanvasTicksAndBands($t, $t.data('tileId'), $t.data('bppp'), zoom);
    });
  },
 
  _ntSequenceLoad: function(dna, extraData) {
    if (!dna) { return; }
    var o = extraData._self.options,
      $d = extraData._d,
      l = extraData._l,
      ppbp = o.tileWidth / l, // pixels per bp
      colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,180,0', n:'100,100,100'},
      prevColor = null,
      canvas, height, ctx, nt, nextColor;
    if (dna.length < l) { dna += Array(l - dna.length + 1).join(' '); }  
    if ($d) {
      var $svg = $.mk("http://www.w3.org/2000/svg", "svg").attr({
        version: "1.2",
        baseProfile: "tiny",
        height: '14px',
        width: ($d.closest('.tile').width() || extraData._w) + 'px',
        // Tells the GreenSock Draggable in genoline to ignore click events so NT's can be highlighted
        "data-clickable": 'true'
      });
      $d.append($svg);
      $.mk("http://www.w3.org/2000/svg", "text").attr({
        x: _.map(_.range(l), function(x) { return x / l * 100; }).join('% ') + '%',
        y: 11,
        fill: '#FFFFFF'
      }).text(dna).appendTo($svg);
    }
    // FIXME: this should go into `renderSequence` in the `ruler` type of CustomTrack
    canvas = extraData._c && extraData._c.get(0);
    height = canvas.unscaledHeight();
    ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { return; }
    for (var i = 0; i < l; i++) {
      nt = dna.substr(i, 1).toLowerCase(),
        nextColor = "rgb(" + (colors[nt] || colors.n) + ")";
      if (nt == '-') { continue; }
      if (nextColor !== prevColor) { ctx.fillStyle = nextColor; }
      ctx.fillRect(i * ppbp, 0, ppbp, height);
      prevColor = nextColor;
    }
  },
 
  _customTileRender: function(e, callback) {
    var canvas = this,
      $canvas = $(this),
      d = e.data,
      self = d.self,
      track = self.options.track,
      $tile = $canvas.closest('.tile'),
      $browser = self.options.browser,
      renderingKey = d.start + '-' + d.end + '-' + d.density,
      seqPadding = d.custom.expectedSequencePadding || 0;
    
    function pushCallback() { _.isFunction(callback) && $canvas.data('renderingCallbacks').push(callback); }
    // If 'render' is triggered >1x on the same region + <canvas>, add the callback to a queue and don't repeat work
    if (canvas.rendering == renderingKey) { pushCallback(); return; } 
   
    canvas.rendering = renderingKey;
    $canvas.data('renderingCallbacks', []);
    pushCallback();
   
    // Note: d.start and d.end are 1-based genomic coordinates. This is an asynchronous function call.
    d.custom.render(canvas, d.start, d.end, d.density, function() {
      // Check if the canvas was recycled and was already asked to render a different region; if so, exit early
      if (canvas.rendering != renderingKey) { return; }
      
      $canvas.css('height', d.custom.stretchHeight ? '100%' : canvas.unscaledHeight());
      $canvas.toggleClass('stretch-height', d.custom.stretchHeight);
      $canvas.removeClass('unrendered').addClass('no-areas');
     
      self.fixClickAreas();
      self.fixClippedDebounced();
     
      // If the tooMany flag was set, we couldn't draw/load the data at this density because there's too much of it
      // If this is at "squish" density, we also add the class to parent <div> to tell the user that she needs to zoom
      if (canvas.flags.tooMany) {
        $canvas.addClass('too-many');
        if (d.density != 'pack') { $tile.addClass('too-many'); }
        if (d.density == 'dense') { $tile.addClass('too-many-for-dense'); }
      }
     
      _.each($canvas.data('renderingCallbacks'), function(f) { f(); });
      canvas.rendering = false;
      // FIXME: trigger self.element.trigger('trackload', self.bppps()) if everything in this track is done rendering
    });
   
    if (d.custom.expectsSequence && (d.end - d.start) < $browser.genobrowser('option', 'maxNtRequest')) {
      $browser.genobrowser('getDNA', d.start - seqPadding, d.end + seqPadding, function(sequence) {
        d.custom.renderSequence(canvas, d.start, d.end, d.density, sequence, function() {
          // TODO: may need to self.fixClickAreas() again if .renderSequence added areas?
        });
      });
    }
  },
 
  _customTile: function($t, tileId, bppp, bestDensity) {
    var self = this,
      o = self.options,
      bpPerTile = bppp * o.tileWidth,
      end = tileId + bpPerTile,
      $sc;
      
    $t.addClass('tile-custom tile-full tile-loaded bppp-'+classFriendly(bppp));
    $sc = $.mk('div').attr('class', 'tsc tile-scroll-cont').appendTo($t);
    $.mk('div').attr('class', 'clip-indicator top').appendTo($t);
    $.mk('div').attr('class', 'clip-indicator bottom').appendTo($t);
    
    _.each(o.track.s, function(density) {
      var $c = $.mk('canvas').attr('class', 'tdata unrendered dens-' + density), 
        $lc = [];
      
      $c.attr('id', 'canvas-' + self.uniqId + '-' + self._customCanvasCounter++);
      $c.appendTo($sc);
      if (density != 'dense') { $c.css('top', -self._scrollTop); }
      $c.canvasAttr({width: o.tileWidth, height: o.track.h});
      
      if (density == 'pack') {
        $lc = $.mk('canvas').data('density', density).appendTo($sc);
        $lc.attr('class', 'labels dens-' + density);
        $lc.attr('id', 'labels-' + self.uniqId + '-' + self._customCanvasCounter++);
      }

      $c.bind('render', {start: tileId, end: end, density: density, self: self, custom: o.track.custom}, self._customTileRender);
      // FIXME: the following doesn't actually erase the canvas the way we originally intended. Is this method even needed?
      $c.add($lc).bind('erase', function() { $(this).addClass('unrendered'); }); //o.track.custom.erase($c.get(0));  });
    
      if (density == bestDensity) { $c.add($lc).addClass('dens-best'); $c.trigger('render'); }
      $c.one('bestDensity', function() { if ($c.hasClass('unrendered')) { $c.trigger('render'); } });
    });
  },

  // Runs when the custom track's properties change outside of parsing or using the track options dialog
  // These changes might require us to update the UI, which we do here.
  _customTrackPropsUpdated: function(props) {
    var self = this,
      topBppp = self.bppps().top;
    // For now, the only custom track property that might change the genotrack UI are the track scales.
    if (props.scales) {
      self.options.scales = props.scales;
      self._fixSide(self._bestDensity(topBppp), topBppp, true);
    }
  }
 
});

};