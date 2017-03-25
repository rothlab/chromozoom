// ===================================================================
// = Each line of the $.ui.genobrowser is managed by a $.ui.genoline =
// ===================================================================

module.exports = function($, _) {

var utils = require('./utils.js')($);

require('./greensock/Draggable.min.js');

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

    html = '<div class="c nw"/><div class="c ne"/><div class="c sw"/>' +
      '<div class="c se"/><div class="v n"/><div class="v s"/><div class="inner-retic">' +
      '<div class="c nw"/><div class="c ne"/><div class="c sw"/><div class="c se"/></div>';
    $(html).appendTo(this.$retic);
    html = '<div class="start"></div><div class="end"></div>';
    $(html).appendTo(this.$indices);

    this._initDraggable();
    this._initSideSortable();
    this.$trackCont.bind('dblclick', {self: this}, this._recvDoubleClick);
    $elem.addClass('shadow');
    this.fixTracks();
    this.jumpTo(this.pos);
  },

  _initDraggable: function() {
    var self = this, $elem = this.element, o = this.options,
    throw_; // avoid conflict with throw keyword

    // Instead of jQuery UI's $.ui.draggable, we use GreenSock Animation Platform for better performance
    // GreenSock uses modern JS animation techniques and leverages hardware acceleration wherever possible
    // We can't use GreenSock's ThrowPropsPlugin because it is non-free, but we can replicate the bit of
    // functionality we need for "throwing" by measuring velocity and tweening a throw ourselves
    // TODO: Do we really care about vertical dragging (lineShift)?
    self.throw = throw_ = {};
    self.draggable = new Draggable(self.$cont.get(0), {
      type: "x",
      onPress: function(e) {
        // Both of these are needed to refresh the UI in case this interrupted a throw
        self.fixTrackTiles();
        self.fixIndices();
      },
      onDragStart: function(e) {
        self.hideIndices();
        $('body').addClass('dragging');
        o.browser.genobrowser('showReticle', 'dragging', true);
        $.tipTip.hide();
        throw_.lastT = utils.now();
      },
      onDrag: function(e) {
        var now = utils.now(),
          deltaT = now - throw_.lastT;                    // in ms
        throw_.velocity = this.deltaX / deltaT;           // in px / ms
        throw_.lastT = now;
        self._setPosFromX(this.x, e.pageY);
        self.fixFirstLabel();
      },
      onDragEnd: function(e) {
        $('body').removeClass('dragging');
        o.browser.genobrowser('showReticle', 'dragging', false);
        self.startThrow(throw_.velocity, this.x) || self.startBounce(throw_.velocity, this.x);
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

  getPos: function() {
    return this.pos;
  },

  _setPosFromX: function(x, top) {
    var o = this.options,
      $elem = this.element,
      zoom = o.browser.genobrowser('zoom');
    this.pos = o.origin - x * zoom;
    o.browser.genobrowser('recvDrag', $elem, this.pos);
  },

  jumpTo: function(pos, forceRepos) {
    var o = this.options,
      zoom = o.browser.genobrowser('zoom'),
      x = (o.origin - pos) / zoom;
    // Mozilla gets aggravated by CSS lengths outside of ±1.0e7; Opera gets aggravated somewhere outside of ±1.0e6
    if (x > 1.0e+6 || x < -1.0e+6) { o.origin = pos; x = 0; forceRepos = true; }
    this.pos = pos;
    TweenLite.set(this.$cont, {x: x});
    this.draggable.x = x;
    this.draggable.update();
    this.fixTrackTiles(forceRepos);
    this.fixFirstLabel();
    this.fixIndices();
  },
  
  // What x positions for the draggable element are the margins allowable to keep the genome in view?
  xMargins: function() {
    var o = this.options,
      $lines = o.browser.genobrowser('lines'),
      numLines = $lines.length,
      lineIndex = numLines == 1 ? 0 : $lines.index(this.element),
      bpWidth = o.browser.genobrowser('bpWidth'),
      zoom = o.browser.genobrowser('zoom');
      
    return [(o.origin - o.genomeSize - (lineIndex - o.bounceMargin) * bpWidth) / zoom, 
            (o.origin + (numLines - lineIndex - o.bounceMargin) * bpWidth) / zoom];
  },

  // Start a throwing animation. Must specify an initial velocity, vInit, in px/ms.
  startThrow: function(vInit, xInit) {
    var self = this,
      throw_ = self.throw,
      contEl = self.$cont.get(0),
      o = self.options,
      xMargins = self.xMargins(),
      duration, decel, throwDistance, xFinal;

    // Don't allow throws below a certain initial speed; instead stop and check for a bounce
    if (!vInit || Math.abs(vInit) < 0.1) { self.fixIndices(); return false; }

    vInit = Math.max(-5.0, Math.min(vInit, 5.0));      // Clip the initial speed to a reasonable range
    if (_.isUndefined(xInit)) { xInit = contEl._gsTransform.x; }
    throw_.lastRefresh = xInit;
    decel = vInit > 0 ? 0.001 : -0.001;                // in px / ms^2
    duration = vInit / decel;                          // in ms
    throwDistance = (vInit * vInit) / (2 * decel);     // in px
    xFinal = xInit + throwDistance;
    
    // Short throws from beyond the margins into the genome (that can't reach it) are better handled by bounces
    if (xFinal < xMargins[0] && vInit > 0) { return false; }
    if (xFinal > xMargins[1] && vInit < 0) { return false; }
    
    // All good to throw, 
    throw_.tween = TweenLite.to(self.$cont, duration / 1000.0, {
      x: xFinal,
      ease: Power1.easeOut,
      onUpdate: function() {
        var x = contEl._gsTransform.x,
          vNew;
        self._setPosFromX(x);
        self.fixFirstLabel();
        // Did we travel beyond the margins of the genome? If yes, start a bounce now (which cancels this tween)
        if ((x < xMargins[0] && vInit < 0) || (x > xMargins[1] && vInit > 0)) {
          vNew = (vInit > 0 ? 1 : -1) * Math.sqrt(vInit * vInit + 2 * decel * (x - xInit)); // in px/ms
          self.startBounce(vNew, x);
        }
        if (Math.abs(x - throw_.lastRefresh) > 1000) { throw_.lastRefresh = x; self.fixTrackTiles(); }
      },
      onComplete: function() {
        var x = contEl._gsTransform.x;
        self._setPosFromX(x);
        self.fixIndices();
        self.fixTrackTiles();
      }
    });
    return true;
  },

  // Cancel the current throwing animation.
  stopThrow: function() {
    var tween = this.throw && this.throw.tween;
    if (tween && tween.isActive()) { 
      this.fixTrackTiles();
      tween.kill();
    }
  },
  
  // Start a bouncing animation from beyond the margins of genome to the nearest margin.
  // Can specify an initial velocity, vInit, in px/ms.
  startBounce: function(vInit, xInit) {
    var self = this,
      throw_ = self.throw,
      contEl = self.$cont.get(0),
      xMargins = self.xMargins(),
      bounceDuration = 500,            // perhaps nicer to not make this a constant?
      offRight, xFinal, twoTween, marginDist, bounceBackEase,
      bounceOutDecel, bounceOutDuration, bounceOutDistance;
    
    vInit = Math.max(-5.0, Math.min(vInit || 0, 5.0));  // Clip the initial speed to a reasonable range
    if (_.isUndefined(xInit)) { xInit = contEl._gsTransform.x; }
    if (xInit > xMargins[0] && xInit < xMargins[1]) { return; }

    self.stopThrow();
    throw_.lastRefresh = xInit;
    offRight = xInit < xMargins[0];
    xFinal = offRight ? xMargins[0] : xMargins[1];
    // Bounces where the initial velocity is away from the margin are animated with two tweens:
    // a bounce out, and a bounce back.
    twoTween = (offRight && vInit < 0) || (!offRight && vInit > 0);
    bounceBackEase = twoTween ? Power2.easeInOut: Power2.easeOut;
    marginDist = offRight ? xMargins[0] - xInit : xInit - xMargins[1];
    
    function bounceBack() {
      throw_.tween = TweenLite.to(self.$cont, bounceDuration / 1000.0, {
        x: xFinal,
        ease: bounceBackEase,
        onUpdate: function() {
          var x = contEl._gsTransform.x;
          self._setPosFromX(x);
          self.fixFirstLabel();
          if (Math.abs(x - throw_.lastRefresh) > 1000) { throw_.lastRefresh = x; self.fixTrackTiles(); }
        },
        onComplete: function() {
          var x = contEl._gsTransform.x;
          self._setPosFromX(x);
          self.fixIndices();
          self.fixTrackTiles();
        }
      });
    }
    
    // If we're doing two tweens, we have to bounce outward before bouncing back.
    if (twoTween) {
      bounceOutDecel = (vInit > 0 ? 0.07 : -0.07) * (1 + marginDist * 0.01);   // in px / ms^2
      bounceOutDuration = vInit / bounceOutDecel;                              // in ms
      bounceOutDistance = (vInit * vInit) / (2 * bounceOutDecel);              // in px
      throw_.tween = TweenLite.to(self.$cont, bounceOutDuration / 1000.0, {
        x: xInit + bounceOutDistance,
        ease: Power1.easeOut,
        onUpdate: function() {
          var x = contEl._gsTransform.x;
          self._setPosFromX(x);
          self.fixFirstLabel();
          if (Math.abs(x - throw_.lastRefresh) > 1000) { throw_.lastRefresh = x; self.fixTrackTiles(); }
        },
        onComplete: bounceBack
      });
    } else {
      bounceBack();
    }
  },
  
  // alias stopBounce to stopThrow, since they both do the same thing: stop the current tween
  stopBounce: function() { this.stopThrow.apply(this, argument); },

  fixTrackTiles: function(forceRepos) {
    this.$cont.children('.browser-track').genotrack('fixTiles', forceRepos);
  },

  redrawAreaLabels: function() {
    var $elem = this.element;
    _.each(this.options.browser.genobrowser('tracks'), function(t) {
      if (t.custom) { $elem.find('.browser-track-'+t.n).genotrack('redrawAreaLabels'); }
    });
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
    var self = this, $elem = self.element, o = self.options,
      firstLabelOccluded = false,
      $rulerLabels = $elem.find('.browser-track-ruler .label'),
      predictedWidth, dragContLeft, label;

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
    label = o.browser.genobrowser('chrAt', self.pos);
    if (label !== self.$firstLabel.data('content')) {
      if (label === null) {
        // We are behind chr1.
        self.$firstLabel.addClass('occluded').data('content', null);
        $elem.find('.browser-track-ruler .label').removeClass('occluded');
      } else {
        self.$firstLabel.text(label.n).removeClass('occluded').data('content', label);
      }
    }

    // If we are behind chr1, it's impossible for the firstLabel to occlude any labels
    if (label === null) { return; }
    // If no labels are on the screen, no occlusion by firstLabel is possible...
    if (!$rulerLabels.length) { return; }

    // Check occlusion of other labels and set the appropriate classes so they are visible thru the firstLabel
    // We take pains to avoid calling .offset(), because that triggers a re-layout (expensive!)
    dragContLeft = self.$cont.get(0)._gsTransform.x;
    predictedWidth = label.n.length * 19;
    $rulerLabels.each(function() {
      var thisLeft = dragContLeft + parseInt(this.style.left, 10),
        maxWidth = parseInt($(this).children('.label-text').get(0).style.maxWidth, 10),
        thisWidth = Math.min($(this).text().length * 19, maxWidth),
        occlusion = thisLeft + thisWidth > 0 && thisLeft < predictedWidth;
      firstLabelOccluded = firstLabelOccluded || occlusion;
      $(this).toggleClass('occluded', occlusion);
    });
    self.$firstLabel.toggleClass('occluded', firstLabelOccluded);
  },

  hideIndices: function() {
    this.$indices.children('.start').empty();
    this.$indices.children('.end').empty();
    this.$retic.children('.n').empty();
  },

  fixIndices: function() {
    var o = this.options,
      pos = this.pos,
      bpWidth = o.browser.genobrowser('bpWidth'),
      zoom = o.browser.genobrowser('zoom'),
      elem = this.element.get(0),
      $lines = o.browser.genobrowser('lines'),
      multipleLines = $lines.length > 1,
      reticPos = this.centeredOn === null ? this.pos + 0.5 * (bpWidth - o.sideBarWidth * zoom) : this.centeredOn,
      chrStart, chrEnd, chrRetic;

    if (elem == $lines.get(0)) {
      chrStart = o.browser.genobrowser('chrAt', pos) || o.chrLabels[0];
      this.$indices.children('.start').text((multipleLines ? chrStart.n + ':' : '') + Math.floor(pos - chrStart.p));
    } else { this.$indices.children('.start').empty(); }

    if (elem == $lines.last().get(0)) {
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