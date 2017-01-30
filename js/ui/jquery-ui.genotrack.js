// ====================================================================
// = Each track within a $.ui.genoline is managed by a $.ui.genotrack =
// ====================================================================

module.exports = function($) {

var utils = require('./utils.js')($),
  pad = utils.pad,
  classFriendly = utils.classFriendly,
  shortHash = utils.shortHash,
  floorHack = utils.floorHack;

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
      o = this.options,
      bppps;
    if (!o.line) { throw "Cannot instantiate ui.genotrack without specifying 'line' option"; }
    if (!o.side) { throw "Cannot instantiate ui.genotrack without specifying 'side' option"; }
    self.ruler = o.track.n == 'ruler';
    self.sliderBppps = o.bppps.concat(o.overzoomBppps);
    self.tileLoadCounter = self.areaLoadCounter = 0;
    self.custom = !!o.track.custom;
    self.birth = (new Date).getTime();
    self.$side = $(o.side).append('<div class="subtrack-cont"><div class="scales"></div></div>');
    self.fixClippedDebounced = _.debounce(self.fixClipped, 500);
    if (self.custom) {
      o.scales = o.track.custom.scales;
      // Some custom track types defer expensive parts of setup until they're about to be displayed
      o.track.custom.finishSetupAsync();
      o.track.custom.onSyncProps = function(props) { self._customTrackPropsUpdated(props); }; 
    }
    
    $elem.addClass('browser-track-'+o.track.n).toggleClass('no-ideograms', self.ruler && !o.chrBands);
    self._nearestBppps(o.browser.genobrowser('zoom'));
    // If the track has multiple densities, or its single density has multiple fixed heights,
    // make the sidebar resizable
    self._initSideResizable();
    self._availDensities();
    self.loadingCounter = 0;
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
        if (!self.ruler && !self.custom) {
          var $imgs = $('.browser-track-'+o.track.n+'>.bppp-'+classFriendly(bppp)+' img.tdata'),
            maxHeight = Math.max.apply(Math, $imgs.map(function() { 
              return this.naturalHeight || this.height; 
            }).get());
          $(this).resizable('option', 'maxHeight', Math.max(maxHeight * 1.2, ui.originalSize.height, 18));
        }
        if (self.custom) {
          if (customHeights.max) { $(this).resizable('option', 'maxHeight', customHeights.max - paddingBordersY); }
          if (customHeights.min) { $(this).resizable('option', 'minHeight', customHeights.min - paddingBordersY); }
        }
        if (!self.ruler) {
          self.snaps = fixedHeights && _.map(fixedHeights, function(v, k) { return k=='dense' ? v : v + 1; });
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
      $scale.css('top', scale.top || 0);
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
          else { $tick.css('top', position + '%'); }
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
          if (this.height < height) { $(this).attr('height', height).trigger('render'); }
        });
      }
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
    if (_.isFunction(callback)) { 
      this.element.animate({height: height}, o.lineFixDuration, callback).css('overflow', 'visible'); 
    } else { this.element.height(height); }
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
    return _.min(densities, function(d) { return densityOrder[d]; })
  },
  
  updateDensity: function() {
    var self = this,
      o = self.options,
      $elem = self.element,
      topBppp = self.bppps().top;
    var bestDensity = self._bestDensity(topBppp);
    // Fix side labels (e.g. for subtracks) for the best density
    self._fixSide(bestDensity, topBppp);
    // Set the best density and trigger events on these tiles
    $elem.find('.tile-full').children('.tdata,.area.label,.labels').each(function() {
      var $this = $(this),
        isBest = $this.hasClass('dens-'+bestDensity);
      $this.toggleClass('dens-best', isBest);
      if (isBest) { $this.trigger('bestDensity'); }
    });
    // Finally, fix clipping indicators
    self.fixClipped();
  },
  
  _nearestBppps: function(zoom) {
    var o = this.options, 
      bppps = { nearest: [o.bppps[0]], cache: [], top: o.bppps[0] },
      possibleBppps = this.ruler ? this.sliderBppps : o.bppps,
      l = possibleBppps.length,
      found = false,
      shrinkableWindow, getNext;
    for (var i = 0; i < l; i++) {
      var zoomDiff = zoom - possibleBppps[i];
      if (zoomDiff > 0) {
        shrinkableWindow = (possibleBppps[i + 1] || possibleBppps[i] / 3);
        getNext = 0 + (zoomDiff < shrinkableWindow);
        bppps.nearest = possibleBppps.slice(Math.max(i - 2 + getNext, 0), i + getNext);
        if (getNext) { bppps.cache = [false, zoomDiff > shrinkableWindow / 2]; }
        bppps.top = bppps.cache[1] ? bppps.nearest[0] : bppps.nearest.slice(-1)[0];
        found = true; break;
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
      prevTop = this._bppps && this._bppps.top,
      bppps = this.bppps(forceRepos),
      $notNeeded;
    _.each(bppps.nearest, function(bppp, i) {
      var bpPerTile = o.tileWidth * bppp,
        tileId = floorHack((pos - availWidth * bppp * (bppps.cache[i] ? 0 : 1)) / bpPerTile) * bpPerTile + 1,
        tilesNeeded = [tileId],
        rightMargin = pos + (bppps.cache[i] ? 1 : 2) * availWidth * bppp,
        bestDensity = self._bestDensity(bppp);
      while ((tileId += bpPerTile) < rightMargin) { tilesNeeded.push(tileId); }
      _.each(tilesNeeded, function(tileId) {
        var repos = false, $t = $('#' + self._tileId(tileId, bppp));
        if (!$t.length) { 
          $t = self._addTile(tileId, bppp, bestDensity, bppps.cache[i]); 
          repos = true; 
        }
        if (!bppps.cache[i]) { self._showTile($t); }
        if (repos || forceRepos) { self._reposTile($t, tileId, zoom, bppp); }
        allTilesNeeded.push($t.get(0));
      });
    });
    $notNeeded = $elem.children('.tile').not(allTilesNeeded);
    self.tileLoadCounter -= $notNeeded.children('.loading').length;
    $notNeeded.remove();
    if (prevTop && prevTop != bppps.top) { self.updateDensity(); }
    this._fixChrLabels(forceRepos);
    this._fixSideClipped();
  },
  
  _setImgDims: function(e) {
    // NOTE: this is only used as bound to a tile <img>'s onLoad! See _addTile
    var self = this,
      h = this.naturalHeight || this.height;
    $(this).css('height', h).css('width', '100%');
  },
  
  _trackLoadFire: function(e) {
    // NOTE: this is only used as bound to a tile <img>'s onLoad! See _addTile
    var self = e.data.self,
      trackH = self.options.track.h,
      $t = e.data.tile,
      h = this.naturalHeight || this.height;
    $(this).removeClass('loading');
    if (e.data.isBest && e.type != 'error') { 
      $t.addClass('tile-loaded');
      if (h > trackH) { $t.addClass('clipped'); }
      if (!e.data.cached) { self._showTile($t); }
    }
    // e.data.self.availDensities[bppp] = _.without(densities, density); // FIXME, how to knock out tracks that don't load?
    if (--self.tileLoadCounter === 0) { self.element.trigger('trackload', self.bppps()); };
  },
  
  _addTile: function(tileId, bppp, bestDensity, cached) {
    var self = this,
      o = self.options,
      $elem = self.element,
      $d = $.mk('div').attr('class', 'tile'),
      bpPerTile = o.tileWidth * bppp,
      special = self._specialTile(tileId, bppp),
      densities = self.availDensities[bppp],
      $tileBefore = $('#' + self._tileId(tileId - bpPerTile, bppp));
    if ($tileBefore.length) { $d.insertAfter($tileBefore); }
    else { $d.prependTo(self.element) };
    $d.attr('id', self._tileId(tileId, bppp)).data({zIndex: _.indexOf(self.sliderBppps, bppp), tileId: tileId});
    if ($.support.touch) { self._tileTouchEvents($d); }
    else { $d.mousemove({self: self}, self._tileMouseMove).mouseout({self: self}, self._tileMouseOut); }
    if (special) {
      if (special.blank) { $d.addClass('tile-blank').addClass('tile-off-' + (special.left ? 'l' : 'r')); }
      else if (special.custom) { self._customTile($d, tileId, bppp, bestDensity); }
      else { self._rulerTile($d, tileId, bppp); } // special.ruler === true
      return $d;
    }
    $d.addClass('tile-full bppp-'+classFriendly(bppp));
    _.each(densities, function(density) {
      var tileSrc = self._tileSrc(tileId, bppp, density), 
        fixedHeight = o.track.fh[tileSrc.bpppFormat] && o.track.fh[tileSrc.bpppFormat][density],
        $i;
      if (fixedHeight) {
        $i = $.mk('img').addClass('tdata loading dens-'+density).css('width', '100%').css('height', fixedHeight);
        $d.append($i);
      } else {
        $i = $.mk('img').addClass('tdata loading dens-'+density).bind('load', self._setImgDims);
        $d.append($i);
      }
      self.tileLoadCounter++;
      $i.bind('load error', {self: self, tile: $d, isBest: density==bestDensity, cached: cached}, self._trackLoadFire);
      $i.toggleClass('dens-best', density == bestDensity);
      if (o.track.m && _.include(o.track.m, density)) { $i.addClass('no-areas'); }
      
      $i.attr('src', o.tileDir + tileSrc.full);
    });
    return $d;
  },
  
  // Shows orange clipping indicators if any of the best density tiles have data cut off at the bottom
  fixClipped: function() {
    var $elem = this.element,
      o = this.options,
      sideClipped = false;
    $elem.find('.tile-full').each(function() {
      var $t = $(this),
        best = $t.children('.tdata.dens-best:not(.loading):not(.stretch-height)').get(0),
        h = best && (best.naturalHeight || best.height) || 0,
        clipped = h > o.track.h;
      $t.toggleClass('clipped', clipped);
    });
    this._fixSideClipped();
  },
  
  _fixSideClipped: function() {
    var bppps = this.bppps(),
      o = this.options,
      pos = o.line.genoline('getPos'),
      zoom = o.browser.genobrowser('zoom'),
      bpWidth = o.browser.genobrowser('bpWidth'),
      tileBpWidth = bppps.top * o.tileWidth,
      clipped = false;
    this.element.children('.clipped.bppp-'+classFriendly(bppps.top)).each(function() {
      var tileId = $(this).data('tileId');
      if (tileId > pos - tileBpWidth && tileId < pos + bpWidth) { clipped = true; return false; }
    });
    this.$side.toggleClass('clipped', clipped);
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
  // in JS directly on the list of areas rather than add/remove many DOM elements
  // to achieve the same
  _tileMouseMove: function(e) {
    var $targ = $(e.target),
      $tdata = $targ.closest('.tdata'),
      self = e.data.self,
      o = self.options,
      prev = o.browser.genobrowser('areaHover'),
      areas, ratio, bppp;
    if (!$tdata.length || !$tdata.hasClass('dens-best') || !(areas = $tdata.data('areas'))) {
      if (!$targ.is('.area')) { o.browser.genobrowser('areaHover', false); }
      return; 
    }
    bppp = $tdata.data('bppp');
    ratio = bppp / o.browser.genobrowser('zoom');
    var offset = $(this).offset(),
      x = e.pageX - offset.left,
      y = e.pageY - offset.top;
    for (var i = 0; i < areas.length; i++) {
      var v = areas[i], areaId;
      if (x > v[0] * ratio && x < v[2] * ratio && y > v[1] && y < v[3]) {
        if (o.track.n + '.hrefHash.' + v.hrefHash !== prev) {
          areaId = $(this).attr('id') + '.' + i;
          o.browser.genobrowser('areaHover', [o.track.n, bppp, $tdata.data('density'), 'hrefHash', v.hrefHash], areaId);
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
    if (!$relTarget.is('.tile') && !$relTarget.closest('.tile').length) { self.options.browser.genobrowser('areaHover', false); }
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
  
  _areaTipTipEnter: function(callback) {
    var self = $(this).data('genotrack'),
      href = $(this).attr('href'),
      tiptipData = $(this).data('tiptipData'),
      oldTitle = $(this).data('title');
    if ($('body').hasClass('dragging')) { return callback(false); }
    function createTipTipHtml(data) {
      var $tipTipDiv = $('<div/>'),
        $name = $('<div class="name"/>').appendTo($tipTipDiv),
        $table = $('<table/>').appendTo($tipTipDiv),
        $tbody = $('<tbody/>').appendTo($table),
        $prevDescTr;
      _.each(data, function(v, k) {
        var $tr;
        if (/^description$|^type$|refseq summary/i.test(k)) {
          $prevDescTr = $tbody.children('.desc');
          if ($prevDescTr.length) { $tr = $('<tr class="desc"/>').insertAfter($prevDescTr); }
          else { $tr = $('<tr class="desc"/>').prependTo($tbody); }
          if (v.length > 300) { v = v.substr(0, 300).replace(/\s+\S+$/, '') + '...'; }
          $('<td colspan="2"/>').text(v).appendTo($tr);
        } else {
          $tr = $('<tr/>').appendTo($tbody);
          if (v == '---') {
            $('<td colspan="2" class="fields-header"/>').text(k).appendTo($tr);
          } else {
            $('<td class="field" width="45%"/>').text(k).appendTo($tr);
            $('<div/>').text(v).appendTo($('<td class="value" width="55%"/>').appendTo($tr));
          }
        }
      });
      if (oldTitle) { $name.text(oldTitle); }
      callback($tipTipDiv);
    }
    if (tiptipData) {
      createTipTipHtml(tiptipData);
    } else if (href.indexOf(self.options.ucscURL.replace(/\w+$/, '')) === 0) {
      $.ajax(self.options.ajaxDir + 'tooltip.php', {
        data: {url: href},
        dataType: 'json',
        success: createTipTipHtml
      });
    }
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
      scaleToPct = 100 / o.tileWidth,
      $a = $.mk('a').addClass('area dens-'+density+' href-hash-'+hash).attr('title', area[4]);
    $a.attr('href', (custom ? '' : this.baseURL) + area[5]).attr('target', '_blank');
    $a.css({top: area[1], height: area[3] - area[1] - 2});
    if (flags.label) { 
      $a.css({right: (100 - area[0] * scaleToPct) + '%', color: 'rgb(' + (area[7] || defaultColor) + ')'}).addClass('label');
      if (area[8]) { $a.html(area[8]) } else { $a.text(area[4]); }
      $a.mouseover({self: this, bppp: bppp, density: density, hrefHash: hash, areaId: $tile.attr('id') + '.' + flags.i}, this._areaMouseOver);
    } else {
      // FIXME: We'd need to respect area[10] if set, see FIXME in _drawAreaLabels below
      $a.addClass('rect').css({left: (area[0] * scaleToPct) + '%', width: ((area[2] - area[0]) * scaleToPct) + '%'});
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
    return $a.data('hrefHash', hash).toggleClass('dens-best', density == bestDensity).appendTo($tile);
  },
  
  _drawAreaLabels: function($tile, bppp, density, areas) {
    var o = this.options,
      custom = o.track.custom,
      xPad = 2,
      fillBg = $(this.element).is(':nth-child(even)') ? '#f3f6fa' : '#ffffff',
      zoom = o.browser.genobrowser('zoom'),
      bestDensity = this._bestDensity(bppp),
      $tdata = $tile.children('.tdata.dens-' + density),
      $oldC = $tile.children('canvas.labels.dens-' + density),
      canvasXScale = bppp / zoom,
      canvasWidth = $tile.width() * 1.2,
      leftOverhang = $tile.width() * 0.2,
      canvasHeight = $tdata.height(),
      canvasAttrs = {"class": 'labels dens-' + density + ($oldC.length ? ' hidden' : ''), width: canvasWidth, height: canvasHeight},
      $c = $.mk('canvas').css('height', canvasHeight).attr(canvasAttrs).data('density', density).appendTo($tile),
      ctx = $c.get(0).getContext,
      defaultFont = "11px 'Lucida Grande',Tahoma,Arial,Liberation Sans,FreeSans,sans-serif",
      defaultColor = (custom && custom.opts.color) || '0,0,0';
    
    if (!ctx) { return; }
    if (!areas) { areas = $tdata.data('areas'); }
    areas = _.filter(areas, function(v) { return !v[6]; }) // Don't draw labels for areas continuing from previous tile
    if ($.browser.opera) { defaultFont = "12px Arial,sans-serif"; } // Opera can only render Arial decently on canvas
    
    ctx = $c.get(0).getContext('2d');
    ctx.font = defaultFont;
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgb(' + defaultColor + ')';
    
    _.each(areas, function(area, i) {
      var x = area[0] * canvasXScale - xPad + leftOverhang,
        y = floorHack((area[1] + area[3]) * 0.5),
        lineHeight = 12,
        textWidth, lines, lineTextColor;
      
      if (area[8]) {
        lines = area[8].split("\n");
        // potentially marked up + multiline text
        _.each(lines, function(l, i) {
          var altColorRegexp = /\[(\d+,\d+,\d+)\]$/,
            m = l.match(altColorRegexp),
            lineY = y - (lines.length - 1) * lineHeight/2 + i * lineHeight,
            lineTextColor = null;
          if (m) {
            lineTextColor = m[1];
            l = l.replace(altColorRegexp, ''); 
          }
          if (fillBg) {
            ctx.fillStyle = fillBg;
            textWidth = ctx.measureText(l).width + 1;
            ctx.fillRect(x - textWidth, lineY - lineHeight * 0.5, textWidth, lineHeight);
          }
          if (lineTextColor || area[7] || fillBg) { 
            ctx.fillStyle = 'rgb(' + (lineTextColor ? lineTextColor : (area[7] ? area[7] : defaultColor)) + ')'; 
          }
          ctx.fillText(l, x, lineY);
          if (lineTextColor) { ctx.fillStyle = 'rgb(' + (area[7] ? area[7] : defaultColor) + ')'; }
        });
      } else {
        if (fillBg) {
          ctx.fillStyle = fillBg;
          textWidth = ctx.measureText(area[4]).width + 1;
          ctx.fillRect(x - textWidth, y - lineHeight * 0.5, textWidth, lineHeight);
        }
        if (area[7] || fillBg) { ctx.fillStyle = 'rgb(' + (area[7] ? area[7] : defaultColor) + ')'; }
        ctx.fillText(area[4], x, y); 
      }
      if (area[7] || fillBg) { ctx.fillStyle = 'rgb(' + defaultColor + ')'; }
      // FIXME: add an adjusted x1 in area[10] that will be used in preference to area[0] during _tileMouseMove if set.
      //        This allows the user to mouseover the text instead of just the feature itself (which can be very small)
      //        Can measure text width with ctx.measureText(text).
      //        _tileMouseMove then needs to check the *right-adjacent* tile's area data for any areas with area[10] < 0.
      //        This adjacent tile can be found via manipulating the tile ID.
      //          - $tile.data('tileId') has the leftmost bp position;
      //          - adding bppp * o.tileWidth to this gives the position of the next tile;
      //          - substituting $tile.attr('id')'s last number with this number gets the HTML ID of the next tile.
      //        Finally, makeAnchor() above needs to respect area[10] when actually positioning the <a>
    });
    
    $c.toggleClass('dens-best', density == bestDensity);
    if ($oldC.length) { 
      $oldC.addClass('hidden');
      $c.removeClass('hidden');
      setTimeout(function() { $oldC.remove(); }, 1000);
    }
  },
  
  redrawAreaLabels: function() {
    var self = this,
      $elem = self.element,
      o = self.options;
    $elem.find('.labels').each(function() {
      var $tile = $(this).parent(),
        density = $(this).data('density'),
        $tdata = $tile.children('.tdata.dens-' + density);
      self._drawAreaLabels($tile, $tdata.data('bppp'), density);
    });
  },
  
  _areaDataFetch: function(e) {
    $.ajax(e.data.src + '.json', {
      dataType: 'json',
      success: e.data.success,
      beforeSend: e.data.beforeSend
    });
  },
  
  _areaDataLoad: function(data, statusText, jqXHR) {
    // NOTE: this is used as an AJAX callback, so this/self must be reobtained from the jqXHR object
    var self = jqXHR._self,
      o = self.options,
      $tile = $(jqXHR._appendTo),
      tileId = $tile.attr('id'),
      $tdata = $tile.children('.tdata.dens-'+jqXHR._density);
    
    function createAreaLabels(e) {
      if (jqXHR._custom.noAreaLabels) { return; }
      self._drawAreaLabels($tile, jqXHR._bppp, jqXHR._density, $tdata.data('areas'));
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
    if (--self.areaLoadCounter === 0) { $(jqXHR._self.element).trigger('areaload', jqXHR._bestDensity); };
  },
  
  _addClickableAreas: function(tdataElem, bppp, density, bestDensity) {
    var self = this,
      o = self.options,
      tagName = tdataElem.tagName.toLowerCase(),
      $tdata = $(tdataElem),
      areaData, edata;
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
    
    if (tagName == 'img') {
      // TODO: make this abortable, for when fixTiles(forceRepos=true) is called before it finishes!
      edata = {src: tdataElem.src, success: self._areaDataLoad, beforeSend: beforeSend};
      if (density==bestDensity) { self._areaDataFetch({data: edata}); }
      else { $tdata.one('bestDensity', edata, self._areaDataFetch); }
    } else if (tagName == 'canvas' && o.track.custom.areas && (areaData = o.track.custom.areas[tdataElem.id])) {
      // For <canvas> tiles on custom tracks, we should already have this info in o.track.custom.areas
      mockJqXHR = {_custom: o.track.custom};
      beforeSend(mockJqXHR);
      self._areaDataLoad(areaData, '', mockJqXHR);
    } else { 
      self.areaLoadCounter--;
      $(tdataElem).removeClass('areas-loading');
    }
  },
  
  _showTile: function($t) {
    $t.addClass('tile-show').css('z-index', $t.data('zIndex'));
  },
  
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
  
  // Is the tile given by tileId and bppp "special", meaning it is either:
  // (1) blank (2) from a custom track or (3) part of a ruler
  // If so, return a simple object describing what kind of special tile it is
  _specialTile: function(tileId, bppp) {
    var o = this.options;
    if (tileId < 0 || tileId > o.genomeSize) { return {blank: true, left: tileId < 0}; }
    if (o.track.custom) { return {custom: true}; }
    if (this.ruler && (bppp <= o.ideogramsAbove || !o.chrBands)) { return {ruler: true}; }
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
  
  _fixChrLabels: function(forceRepos) {
    if (!this.ruler) { return; }
    var self = this,
      o = self.options,
      $elem = self.element,
      availWidth = o.browser.genobrowser('lineWidth'),
      pos = o.line.genoline('getPos'),
      zoom = o.browser.genobrowser('zoom'),
      leftMarg = pos - availWidth * zoom * 0.5,
      rightMarg = pos + 1.5 * availWidth * zoom,
      bppps = this.bppps(),
      labelsNeeded = _.filter(o.chrLabels, function(v) { return v.p > leftMarg && v.p < rightMarg; }),
      labelElements = [];

    _.each(labelsNeeded, function(v) {
      var repos = false, $l = $elem.children('.label-' + v.p);
      if (!$l.length) { $l = self._addLabel(v, zoom); repos = true; }
      if (repos || forceRepos) { self._reposLabel($l, v, zoom); }
      labelElements.push($l.get(0));
    });
    $elem.children('.label').not(labelElements).remove();
  },
  
  _rulerTile: function($t, tileId, bppp) {
    var self = this,
      o = self.options,
      bpPerTile = bppp * o.tileWidth,
      zoom = o.browser.genobrowser('zoom');
    $t.addClass('tile-ruler bppp-'+classFriendly(bppp)).data('bppp', bppp);
    
    self._drawRulerCanvasTicks($t, tileId, bppp, zoom);
    self._drawRulerCanvasChrBands($t, tileId, bppp, zoom);
    
    if (bppp <= o.ntsBelow[0]) {
      var showNtText = bppp <= o.ntsBelow[1],
        canvasHeight = (showNtText ? 12 : 3) + (o.chrBands ? 1 : 0), // with bands, we need an extra pixel
        canvasAttrs = {width: o.tileWidth, height: canvasHeight, "class": "ntdata"};
      $t.addClass('tile-ntdata tile-loaded');
      $t.toggleClass(o.chrBands ? 'tile-overlay-ntdata' : 'tile-big-ntdata', showNtText);
      if (o.chrBands && showNtText) { $t.data('zIndex', 101); } // if we have bands, draw it on top of the bands.
      o.browser.genobrowser('getDNA', tileId, tileId + bpPerTile, self._ntSequenceLoad, {
        _c: $.mk('canvas').attr(canvasAttrs).css('height', canvasHeight).appendTo($t),
        _d: showNtText && $.mk('div').addClass('nts').appendTo($t),
        _w: Math.ceil(o.tileWidth * bppp / zoom),
        _self: self
      });
    }
  },
  
  _drawRulerCanvasTicks: function($t, tileId, bppp, zoom) {
    var self = this,
      o = self.options,
      chr = o.browser.genobrowser('chrAt', tileId),
      bpPerTile = bppp * o.tileWidth,
      scale = Math.round(Math.log(bpPerTile / 10)/Math.log(10)*2),
      tooLong = tileId.toString().length > 8 && scale < 6,
      step = scale % 2 ? (tooLong ? 5 : 2) * Math.pow(10, floorHack(scale/2)) : Math.pow(10, scale/2),
      majorStep = scale % 2 ? (tooLong ? [step * 2, step * 2] : [step * 5, step * 5]) : [step * 5, step * 10],
      start = floorHack((tileId - chr.p) / step) * step + step,
      newChr;
    
    if (bppp <= o.bpppNumbersBelow[0]) {
      $t.toggleClass('tile-halfway', bppp <= o.bpppNumbersBelow[0] && bppp > o.bpppNumbersBelow[1]);
      $t.toggleClass('tile-loaded', bppp <= o.bpppNumbersBelow[1]);
      start -= step;
      var offsetForNtText = !o.chrBands && bppp <= o.ntsBelow[1],
        canvasHeight = o.chrBands ? 23 : (offsetForNtText ? 12 : 23),
        canvasWidth = bppp / zoom * o.tileWidth,
        $oldC = $t.children('canvas.ticks'),
        canvasAttrs = {width: canvasWidth, height: canvasHeight, "class": "ticks" + ($oldC.length ? ' hidden' : '')},
        $c = $.mk('canvas').css('height', canvasHeight).prependTo($t),
        ctx = $c.get(0).getContext,
        textY = o.chrBands ? 16 : (offsetForNtText ? 10 : 16),
        defaultFont = "11px 'Lucida Grande',Tahoma,Arial,Liberation Sans,FreeSans,sans-serif";
      if ($.browser.opera) { defaultFont = "12px Arial,sans-serif"; } // Opera can only render Arial decently on canvas
      if (!ctx) { return; }

      // draw the ticks on the new canvas $c, which is before (and therefore behind) the old canvas $oldC, if it exists
      $c.canvasAttr(canvasAttrs);
      ctx = $c.get(0).getContext('2d');
      ctx.font = defaultFont;
      for (var t = start; t + chr.p < tileId + bppp * o.tileWidth + step; t += step) {
        if (t > o.chrLengths[chr.n]) {
          newChr = o.browser.genobrowser('chrAt', chr.p + t);
          if (chr === newChr) { break; } // off the end of the last chromosome
          t = 0;
          chr = newChr;
          continue; // the label for 0 is never shown
        }
        var unit = _.find([[1000000, 'm'], [1000, 'k'], [1, '']], function(v) { return v[0] <= step; }),
          major = floorHack(t / majorStep[1]),
          minor = (t / unit[0]).toString().substr(major > 0 ? major.toString().length : 0),
          isMajor = !(t % majorStep[0]),
          x = ((t + chr.p - tileId + 0.5) / bpPerTile * canvasWidth);
        if (isMajor) {
          ctx.font = "bold " + defaultFont;
          if (major) {
            ctx.textAlign = 'end';
            ctx.fillText(major, x - 1, textY);
          }
          ctx.textAlign = 'start';
          ctx.fillRect(x, offsetForNtText ? 1 : 3, 1, 19); 
        } else {
          ctx.fillStyle = '#666666';
          ctx.fillRect(x, offsetForNtText ? 1 : 7, 1, 14);
          ctx.fillStyle = '#000000';
        }
        ctx.fillText(minor + (isMajor ? unit[1] : ''), x + 2, textY);
        if (isMajor) { ctx.font = defaultFont; }
      }

      // fade between the old & new canvas elements
      if ($oldC.length) { 
        $oldC.addClass('hidden');
        $c.removeClass('hidden');
        setTimeout(function() { $oldC.remove(); }, 1000);
      }
    }
  },
  
  _drawRulerCanvasChrBands: function($t, tileId, bppp, zoom) {
    var self = this,
      o = self.options,
      leftMarg = tileId,
      bpPerTile = bppp * o.tileWidth,
      rightMarg = tileId + bpPerTile,
      giemsaColors = {gneg: '#e3e3e3', gpos25: '#8e8e8e', gpos50: '#555', stalk: '#555', gpos75: '#393939', 
          gpos100: '#000', gvar: '#000', acen: '#963232'},
      whiteLabel = {gpos50: true, stalk: true, gpos75: true, gpos100: true, gvar: true};
      
    if (!o.chrBands) { return; }
    if (zoom <= o.ideogramsAbove) {
      var firstBandIndex = _.sortedIndex(o.chrBands, [0, 0, leftMarg], function(v) { return v[2]; }),
        lastBandIndex = _.sortedIndex(o.chrBands, [0, rightMarg], function(v) { return v[1]; }),
        bandsToDraw = o.chrBands.slice(firstBandIndex, lastBandIndex),
        canvasHeight = 25,
        canvasWidth = bppp / zoom * o.tileWidth,
        $oldC = $t.children('canvas.bands'),
        canvasAttrs = {width: canvasWidth, height: canvasHeight, "class": 'bands' + ($oldC.length ? ' hidden' : '')},
        $c = $.mk('canvas').css('height', canvasHeight).prependTo($t),
        ctx = $c.get(0).getContext,
        defaultFont = "11px 'Lucida Grande',Tahoma,Arial,Liberation Sans,FreeSans,sans-serif";
      if ($.browser.opera) { defaultFont = "12px Arial,sans-serif"; } // Opera can only render Arial decently on canvas
      if (!ctx) { return; }
      
      // draw the ticks on the new canvas $c, which is before (and therefore behind) the old canvas $oldC, if it exists
      $c.canvasAttr(canvasAttrs);
      ctx = $c.get(0).getContext('2d');
      ctx.font = defaultFont;
      ctx.textAlign = 'center';
      _.each(bandsToDraw, function(band) {
        var left = (band[1] - tileId) / zoom,
          right = (band[2] - tileId) / zoom,
          width = right - left;
        
        if (band[4] == 'acen') {
          var base = left, tip = right;
          if (band[3].substr(0, 1) == 'q') { base = right; tip = left; }
          ctx.fillStyle = '#963232';
          ctx.beginPath();
          ctx.moveTo(base, 2);
          ctx.lineTo(tip, 9);
          ctx.lineTo(tip, 10);
          ctx.lineTo(base, 17);
          ctx.lineTo(base, 2);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(left, 2, width, 1);
          ctx.fillRect(left, 16, width, 1);
          ctx.fillStyle = giemsaColors[band[4]];
          ctx.fillRect(left, 3, width, 13);
          if (width > band[3].length * 10) {
            ctx.fillStyle = whiteLabel[band[4]] ? '#fff' : '#000';
            ctx.fillText(band[3], left + width / 2, 14);
          }
        }
      });
      
      // fade between the old & new canvas elements
      if ($oldC.length) { 
        $oldC.addClass('hidden');
        $c.removeClass('hidden');
        setTimeout(function() { $oldC.remove(); }, 1000);
      }
    }
  },
  
  redrawRulerCanvasTicksAndBands: function() {
    var self = this,
      $elem = self.element, 
      o = self.options,
      zoom = o.browser.genobrowser('zoom');
    $elem.children('.tile-ruler').each(function() {
      var $t = $(this);
      self._drawRulerCanvasTicks($t, $t.data('tileId'), $t.data('bppp'), zoom);
      self._drawRulerCanvasChrBands($t, $t.data('tileId'), $t.data('bppp'), zoom);
    });
  },
  
  _ntSequenceLoad: function(dna, extraData) {
    if (!dna) { return; }
    var o = extraData._self.options,
      $d = extraData._d,
      l = dna.length,
      ppbp = o.tileWidth / l, // pixels per bp
      colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,180,0', n:'100,100,100'},
      prevColor = null,
      canvas, height, ctx, nt, nextColor;
    if ($d) {
      var $svg = $.mk("http://www.w3.org/2000/svg", "svg").attr({
        version: "1.2",
        baseProfile: "tiny",
        height: '14px',
        width: ($d.closest('.tile').width() || extraData._w) + 'px'
      });
      $d.append($svg);
      $.mk("http://www.w3.org/2000/svg", "text").attr({
        x: _.map(_.range(l), function(x) { return x / l * 100; }).join('% ') + '%',
        y: 11,
        fill: '#FFFFFF'
      }).text(dna).appendTo($svg);
    }
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
  
  _addLabel: function(label, zoom) {
    var o = this.options,
      $l = $.mk('div').addClass('label label-'+label.p),
      $lt = $.mk('div').addClass('label-text').prependTo($l).text(label.n.replace(/^chr/,''));
    if (label.n.indexOf('chr') === 0) { $lt.prepend('<span class="chr">chr</span>'); }
    $l.prepend('<span class="start-line"></span>');
    if (label.end === true) { $l.addClass('label-end'); }
    //$l.css('z-index', 200 + label.i);
    return $l.appendTo(this.element);
  },
  
  _reposLabel: function($l, label, zoom) {  
    // constrain width of label so it doesn't run over into the next one
    // max-width doesn't include padding (5px)
    if (label.end !== true) { $l.children('.label-text').css('max-width', Math.max(label.w / zoom - 5, 0)); }
    // `+ 1` --> convert 0-based positioning
    // `- 1` --> label is offset 1px to left to compensate for the 2px width of the red indicator line
    $l.css('left', (label.p + 1 - this.options.line.genoline('option', 'origin')) / zoom - 1);
  },
  
  _customTileRender: function(e, callback) {
    var canvas = this,
      $canvas = $(this),
      d = e.data,
      self = d.self,
      track = self.options.track,
      $browser = self.options.browser;
      
    function pushCallback() { _.isFunction(callback) && $canvas.data('renderingCallbacks').push(callback); }
    if ($canvas.data('rendering') === true) { pushCallback(); return; }
    
    $canvas.data('rendering', true);
    $canvas.data('renderingCallbacks', []);
    if (d.density != 'dense') { self.tileLoadCounter++; }
    pushCallback();
    
    d.custom.render(canvas, d.start, d.end, d.density, function() {
      $canvas.css('width', '100%').css('height', d.custom.stretchHeight ? '100%' : canvas.height);
      $canvas.toggleClass('stretch-height', d.custom.stretchHeight);
      $canvas.removeClass('unrendered').addClass('no-areas');
      
      self.fixClickAreas();
      self.fixClippedDebounced();
      
      // If the too-many class was set, we couldn't draw/load the data at this density because there's too much of it
      // If this is at "squish" density, we also add the class to parent <div> to tell the user that she needs to zoom
      if ($canvas.hasClass('too-many')) {
        if (d.density != 'pack') { $canvas.parent().addClass('too-many'); }
        if (d.density == 'dense') { $canvas.parent().addClass('too-many-for-dense'); }
      }
      
      _.each($canvas.data('renderingCallbacks'), function(f) { f(); });
      $canvas.data('rendering', false);
      
      if (d.density != 'dense' && --self.tileLoadCounter === 0) { self.element.trigger('trackload', self.bppps()); };
    });
    
    if (d.custom.expectsSequence && (d.end - d.start) < $browser.genobrowser('option', 'maxNtRequest')) {
      $browser.genobrowser('getDNA', d.start, d.end, function(sequence) {
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
      end = tileId + bpPerTile;
    $t.addClass('tile-custom tile-full tile-loaded bppp-'+classFriendly(bppp));
    _.each(o.track.s, function(density) {
      var canvasHTML = '<canvas class="tdata unrendered dens-' +density + '" id="canvas-' + self._tileId(tileId, bppp) + '-' + density 
          + '"></canvas>',
        $c = $(canvasHTML).appendTo($t);
      $c.canvasAttr({width: o.tileWidth, height: o.track.h});
      $c.bind('render', {start: tileId, end: end, density: density, self: self, custom: o.track.custom}, self._customTileRender);
      $c.bind('erase', function() { o.track.custom.erase($c.get(0)); $c.addClass('unrendered'); });
      if (density==bestDensity) { $c.addClass('dens-best').trigger('render'); }
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