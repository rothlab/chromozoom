// ===================================================================
// = Each line of the $.ui.genobrowser is managed by a $.ui.genoline =
// ===================================================================

module.exports = function($) {

$.widget('ui.genoline', {

  // Default options that can be overridden
  options: {
    disabled: false
  },

  // Called automatically when widget is instantiated
  _init: function() {
    var $elem = this.element, 
      o = this.options,
      html;
    this.pos = parseInt(o.origin, 10) || 0;
    this.$side = $('<div class="side-cont"/>').appendTo($elem);
    this.$firstLabel = $('<div class="first-label"/>').appendTo($elem);
    this.$trackCont = $('<div class="track-cont"/>').appendTo($elem);
    this.$cont = $('<div class="drag-cont"/>').appendTo(this.$trackCont);
    this.$retic = $('<div class="retic hidden"/>').appendTo($elem);
    this.$indices = $('<div class="indices"/>').appendTo($elem);
    this.$zoomshield = $('<div class="zoom-shield hidden"/>').appendTo($elem);
    this.centeredOn = null; // for the reticle
    
    html = '<div class="c nw"/><div class="c ne"/><div class="c sw"/>'
      + '<div class="c se"/><div class="v n"/><div class="v s"/><div class="inner-retic">'
      + '<div class="c nw"/><div class="c ne"/><div class="c sw"/><div class="c se"/></div>';
    $(html).appendTo(this.$retic);
    html = '<div class="start"></div><div class="end"></div>';
    $(html).appendTo(this.$indices);
    
    this._initContDraggable();
    this._initSideSortable();
    this.$trackCont.bind('dblclick', {self: this}, this._recvDoubleClick);
    $elem.addClass('shadow');
    this.fixTracks();
    this.jumpTo(this.pos);
  },
  
  _initContDraggable: function() {
    var self = this, $elem = this.element, o = this.options, 
      dragEvents = [],
      initKeyedOffset = 0,
      snappingToAnimation = {},
      fudge,
      lineJump,
      topOffsets,
      snappingTo,
      snappingToInterval;
    function snappingToMotion() {
      var dt = (new Date).getTime() - snappingToAnimation.start,
        proportion = Math.min(dt / o.lineFixDuration, 1);
      snappingTo = (1 - Math.pow(1 - proportion, 4)) * (snappingToAnimation.to - snappingToAnimation.from) + snappingToAnimation.from;
      updateLineTop();
      if (proportion == 1) { clearInterval(snappingToInterval); }
    }
    function animateSnap() {
      snappingToAnimation = {from: snappingTo, to: $elem.data('naturalTop'), start: (new Date).getTime()};
      clearInterval(snappingToInterval);
      snappingToInterval = setInterval(snappingToMotion, 13);
    }
    function updateLineTop(top) {
      if (!_.isUndefined(top)) { snappingToAnimation.top = top; }
      var snapOffset = (snappingToAnimation.top - topOffsets.top - topOffsets.click - snappingTo),
        deadZone = o.verticalDragDeadZone / 2,
        snapOffsetSquashed = Math.abs(snapOffset) > deadZone ? snapOffset + (snapOffset > 0 ? -deadZone : deadZone) : 0,
      // First apply a flat dead zone around the zero point
        curved = 40 / (1 + Math.exp(0.1 * snapOffsetSquashed)) - 20 + snapOffsetSquashed;
      // Then use a logistic function transformed to asymptotically approach a slope of 1
      if (topOffsets.length > 1) { $elem.css('top', snappingTo + curved); }
    }
    function updatePos(left, top) {
      var newJump = lineJump, 
        zoom = o.browser.genobrowser('zoom');
      if (!_.isUndefined(top)) {
        _.each(topOffsets, function(v) {
          if (newJump == lineJump && v[1] > lineJump && top < v[0] + fudge) { newJump = v[1]; }
          if (v[1] < lineJump && top > v[0] - fudge) { newJump = v[1]; }
        });
        if (newJump != lineJump) {
          o.browser.genobrowser('shiftLines', newJump - lineJump, $elem.get(0));
          animateSnap();
          self.fixTrackTiles(); 
          lineJump = newJump;
        }
      }
      self.pos = o.origin - left * zoom;
      updateLineTop(top);
      self.fixFirstLabel();
      self.fixIndices();
      o.browser.genobrowser('recvDrag', $elem, self.pos);
    };
    
    self.$cont.mousedown(function() {
      o.browser.find('.drag-cont').stop(); // Stop any current inertial scrolling immediately on mousedown
    })
    self.$cont.draggable({
      axis: 'x',
      cursor: '',
      cancel: '.nts,:input,option',
      start: function(e) { 
        var width = o.browser.genobrowser('lineWidth'),
          $lines =  o.browser.genobrowser('lines').removeClass('last-resized'),
          lineIndex = $lines.index($elem.get(0));
        $('body').addClass('dragging');
        $elem.addClass('last-resized');
        lineJump = 0;
        topOffsets = [];
        fudge = (self.lineHeight() + o.betweenLines) * 0.3;
        snappingTo = $elem.data('naturalTop');
        snappingToAnimation = {};
        topOffsets.click = e.originalEvent.pageY - $elem.offset().top;
        _.each($lines, function(v, i) {
          var top = $(v).offset().top;
          if (i == 0) { topOffsets.top = top; }
          topOffsets.push([top + topOffsets.click, lineIndex - i]); 
        });
        o.browser.genobrowser('showReticle', 'dragging', true);
        $.tipTip.hide();
      },
      drag: function(e, ui) {
        var oe = e.originalEvent, now = (new Date).getTime();
        updatePos(ui.position.left, oe.pageY);
        dragEvents.push({t: now, x: oe.pageX});
        while (dragEvents[0].t < now - 250) { dragEvents.shift(); }
      },
      stop: function(e, ui) {
        var x = e.originalEvent.pageX, 
          now = (new Date).getTime(),
          // the second to last dragEvent seems to be the most informative for velocity.
          dragEvent = dragEvents.slice(-2,-1).pop(), 
          dt = dragEvent && (now - dragEvent.t),
          vInit = dragEvent && (x - dragEvent.x) / dt,
          perfectPageY = (_.isUndefined(snappingToAnimation.to) ? $elem.data('naturalTop') : snappingToAnimation.to) 
            + topOffsets.top + topOffsets.click;
        self.fixTrackTiles();
        $('body').removeClass('dragging');
        updateLineTop(perfectPageY);
        initKeyedOffset = o.browser.genobrowser('keyedOffset');
        o.browser.genobrowser('showReticle', 'dragging', false);
        if (Math.abs(vInit) > 0.1) {
          var xInit = ui.position.left, decel = vInit > 0 ? 0.001 : -0.001, lastRefresh = 0;
          // Why animate margin-right? It's a dummy property that doesn't affect overall drawing. All the actual
          // logic for the animation occurs within the step: function() {} below.
          self.$cont.css('margin-right', -1);
          self.$cont.animate({marginRight: 0}, {
            queue: false,
            duration: Math.abs(vInit / decel),
            step: function() {
              var newTime = (new Date).getTime(),
                deltaT = newTime - now,
                // allow the keyboard to shift the position *during* inertial scrolls
                keyedOffset = o.browser.genobrowser('keyedOffset'),
                deltaL = (vInit*deltaT) - (0.5*decel*deltaT*deltaT) + initKeyedOffset - keyedOffset;
                left = xInit + deltaL;
              // store the velocity on the browser element so it can catch the throw if a bounce is needed
              o.browser.data('velocity', vInit - decel * deltaT);
              // for those looong inertial scrolls, keep the tiles coming
              if (Math.abs(deltaL - lastRefresh) > 1000) { lastRefresh = deltaL; self.fixTrackTiles(); }
              self.$cont.css('left', left);
              updatePos(left);
              o.browser.genobrowser('bounceCheck');
            },
            complete: function() { 
              self.fixTrackTiles(); 
              o.browser.data('velocity', 0);
              o.browser.genobrowser('bounceCheck');
            }
          });
        } else {
          self.fixTrackTiles();
          o.browser.genobrowser('bounceCheck');
        }
      }
    });
  },
  
  _initSideSortable: function() {
    var self = this,
      o = self.options,
      $elem = self.element;
    this.$side.sortable({
      axis: 'y',
      placeholder: 'side placeholder inset-shadow',
      forcePlaceholderSize: true,
      appendTo: '#' + o.browser.attr('id'),
      handle: '.subtrack-cont',
      helper: 'clone',
      start: function() { 
        $('body').addClass('dragging');
        self.$cont.children('.browser-track').each(function(i) { $(this).data('oldIndex', i); });
      },
      stop: function() { $('body').removeClass('dragging'); },
      change: function(e, ui) {
        self.$cont.children('.browser-track').sortElements(function(a, b) {
          a = $(a).genotrack('side');
          a = self.$side.children('.side').index(a.is(ui.item) ? ui.placeholder : a);
          b = $(b).genotrack('side');
          b = self.$side.children('.side').index(b.is(ui.item) ? ui.placeholder : b);
          return a - b;
        });
        self.fixFirstLabel(true);
        self.redrawAreaLabels();
      },
      update: function(e, ui) {
        var newOrder = [];
        self.$cont.children('.browser-track').each(function(i) { newOrder[$(this).data('oldIndex')] = i; });
        o.browser.genobrowser('recvSort', $elem, newOrder);
      }
    });
  },
  
  fixTracks: function() {
    var $elem = this.element, 
      o = this.options,
      $t = this.$cont.children('.browser-track').first(),
      tracks = o.browser.genobrowser('tracks'),
      $u;
      
    if (!$t.length) { $t = this._addTrack(tracks[0], 0); }
    
    // iterate through the new track spec, matching, inserting and deleting tracks as needed
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if ($t.hasClass('browser-track-' + track.n)) { 
        $t = $t.next(); 
      } else if ($t.next().hasClass('browser-track-' + track.n)) {
        $u = $t;
        $t = $t.next().next();
        $u.genotrack('side').remove();
        $u.remove();
      } else { 
        this._addTrack(track, $t);
      }
    }
    
    // deletion
    do { 
      $u = $t; 
      $t = $t.next();
      $u.genotrack('side').remove();
      $u.remove();
    } while ($t.length);
    
    this.$side.sortable('refresh');
    this.fixFirstLabel(true);
    this.redrawAreaLabels();
  },
  
  jumpTo: function(pos, forceRepos) {
    var o = this.options,
      zoom = o.browser.genobrowser('zoom'),
      left = (o.origin - pos) / zoom;
    // Mozilla gets aggravated by CSS lengths outside of ±1.0e7; Opera gets aggravated somewhere outside of ±1.0e6
    if (left > 1.0e+6 || left < -1.0e+6) { o.origin = pos; left = 0; forceRepos = true; }
    this.pos = pos;
    this.$cont.css('left', left);
    this.fixTrackTiles(forceRepos);
    this.fixFirstLabel();
    this.fixIndices();
  },
  
  fixTrackTiles: function(forceRepos) {
    this.$cont.children('.browser-track').genotrack('fixTiles', forceRepos);
  },
  
  redrawAreaLabels: function() {
    var $elem = this.element;
    _.each(this.options.browser.genobrowser('tracks'), function(t) {
      if (t.custom) { $elem.find('.browser-track-'+t.n).genotrack('redrawAreaLabels'); }
    });
  },
  
  getPos: function() {
    return this.pos;
  },
    
  // Adds a $.ui.genotrack for the track specification in `track` to the $.ui.genoline at position `pos`
  //    `pos` can be a numerical index or a jQuery object for the $.ui.genotrack element
  _addTrack: function(track, pos) {
    var $elem = this.element,
      $trk = $('<div class="browser-track"></div>');
    if (!pos || !pos.length) { $trk[pos === 0 ? 'prependTo' : 'appendTo'](this.$cont); }
    else { 
      if (_.isNumber(pos)) { pos = this.$cont.children('.browser-track').eq(pos); }
      $trk.insertBefore(pos); 
    }
    pos = this.$cont.children('.browser-track').index($trk.get(0));
    var $side = $('<div class="side"/>'), $sides = this.$side.children('.side');
    if (pos && $sides.length) { $side.insertAfter($sides.eq(pos - 1)); }
    else { $side.prependTo(this.$side); }
    return $trk.genotrack($.extend({}, this.options, {track: track, line: $elem, side: $side}));
  },
  
  _lineHeight: function() {
    var o = this.options, tracks = o.browser.genobrowser('tracks');
    return _.reduce(tracks, function(t, u) { return {h:t.h + u.h}; }).h;
  },
  
  lineHeight: function() {
    return this._lineHeight();
  },
  
  fixFirstLabel: function(noHorizMotion) {
    var self = this, $elem = self.element, o = self.options;
    if (!self.$firstLabel) { return; }
    if ($elem.get(0) != o.browser.genobrowser('lines').get(0)) { 
      self.$firstLabel.addClass('occluded');
      $elem.find('.browser-track-ruler .label').removeClass('occluded');
      return;
    }
    if (noHorizMotion === true) {
      var $ruler = $elem.find('.browser-track-ruler');
      if (!$ruler.length) { this.$firstLabel.addClass('no-ruler'); }
      else { this.$firstLabel.removeClass('no-ruler').css('top', $ruler.position().top); }
      return;
    }
    // Horizontal motion means we may have to fix the content and occlusion of the label.
    var label = o.browser.genobrowser('chrAt', self.pos), offsetLeft, width;
    $elem.find('.browser-track-ruler .label').removeClass('occluded');
    if (label===null) { self.$firstLabel.addClass('occluded'); return; } // We are behind chr1.
    self.$firstLabel.text(label.n).removeClass('occluded');
    offsetLeft = self.$firstLabel.offset().left;
    width = self.$firstLabel.width();
    $elem.find('.browser-track-ruler .label').each(function() {
      var thisLeft = $(this).offset().left, thisWidth = $(this).width();
      if (thisLeft + thisWidth > offsetLeft && thisLeft < offsetLeft + width) { 
        self.$firstLabel.addClass('occluded');
        $(this).addClass('occluded');
      }
    });
  },
  
  fixIndices: function() {
    var o = this.options,
      pos = this.pos,
      bpWidth = o.browser.genobrowser('bpWidth'),
      zoom = o.browser.genobrowser('zoom'),
      elem = this.element.get(0),
      multipleLines = o.browser.genobrowser('lines').length > 1,
      reticPos = this.centeredOn === null ? this.pos + 0.5 * (bpWidth - o.sideBarWidth * zoom) : this.centeredOn,
      chrStart, chrEnd, chrRetic;
      
    if (elem == o.browser.genobrowser('lines').get(0)) {
      chrStart = o.browser.genobrowser('chrAt', pos) || o.chrLabels[0];
      this.$indices.children('.start').text((multipleLines ? chrStart.n + ':' : '') + Math.floor(pos - chrStart.p));
    } else { this.$indices.children('.start').empty(); }
    
    if (elem == o.browser.genobrowser('lines').last().get(0)) {
      chrEnd = o.browser.genobrowser('chrAt', pos + bpWidth) || o.chrLabels[0];
      this.$indices.children('.end').text((multipleLines ? chrEnd.n + ':' : '') + Math.ceil(pos + bpWidth - chrEnd.p));
    } else { this.$indices.children('.end').empty(); }
    
    chrRetic = o.browser.genobrowser('chrAt', reticPos) || o.chrLabels[0];
    this.$retic.children('.n').text((multipleLines ? chrRetic.n + ':' : '') + Math.floor(reticPos - chrRetic.p));
  },
  
  setReticle: function(nextZooms, centeredOn) {
    var o = this.options,
      zoom = o.browser.genobrowser('zoom'),
      lineWidth = o.browser.genobrowser('lineWidth'),
      bpWidth = lineWidth * zoom,
      width1 = nextZooms[0] / zoom * lineWidth,
      $innerRetic = this.$retic.children('.inner-retic'),
      opacity = nextZooms[1] ? Math.min(2 - 2 * width1 / lineWidth, 1) : 1,
      noCenteredOn = _.isUndefined(centeredOn) || centeredOn === null,
      left = noCenteredOn ? '50%' : (centeredOn - this.pos) / zoom + o.sideBarWidth;
    this.$retic.css('width', width1).css('margin-left', -width1 * 0.5);
    this.$retic.children('.c').css('opacity', opacity);
    if (nextZooms[1]) {
      var width2 = nextZooms[1] / zoom * lineWidth;
      $innerRetic.show().css('width', width2).css('margin-left', -width2 * 0.5);
      $innerRetic.css('opacity', 1 - opacity);
    } else {
      $innerRetic.hide();
    }
    this.$retic.css('left', left);
    this.centeredOn = noCenteredOn ? null : centeredOn;
  },
  
  _recvDoubleClick: function(e) {
    var self = e.data.self,
      $browser = self.options.browser,
      zoom = $browser.genobrowser('zoom'),
      offset = $(self.$trackCont).offset(),
      offsetLeft = (e.pageX + 8) - offset.left; // compensating for the center of the cursor?
    $browser.genobrowser('zoom', !e.shiftKey, self.pos + (offsetLeft * zoom), 1000);
  },
  
  toggleZoomShield: function(show) {
    this.$zoomshield.toggleClass('hidden', !show);
  }
  
});

};