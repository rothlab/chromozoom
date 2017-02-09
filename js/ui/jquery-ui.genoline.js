// ===================================================================
// = Each line of the $.ui.genobrowser is managed by a $.ui.genoline =
// ===================================================================

module.exports = function($) {
  
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
    
    html = '<div class="c nw"/><div class="c ne"/><div class="c sw"/>'
      + '<div class="c se"/><div class="v n"/><div class="v s"/><div class="inner-retic">'
      + '<div class="c nw"/><div class="c ne"/><div class="c sw"/><div class="c se"/></div>';
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
    // TODO: bounceCheck for bouncing off edges; do we really care about vertical dragging (lineShift)?
    // TODO: fix the reticle & side indices
    // TODO: need to re-incorporate fixFirstLabel
    self.throw = throw_ = {};
    self.draggable = new Draggable(self.$cont.get(0), {
      type: "x",
      onDragStart: function(e) {
        self.fixTrackTiles();  // need to do this in case this interrupts a throw right before a refresh is needed
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
      },
      onDragEnd: function(e) {
        $('body').removeClass('dragging');
        o.browser.genobrowser('showReticle', 'dragging', false);
        self.startThrow(throw_.velocity, this.x);
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
  
  startThrow: function(vInit, xInit) {
    var self = this,
      throw_ = self.throw,
      contEl = self.$cont.get(0),
      duration, decel, throwDistance;
    
    if (!vInit || Math.abs(vInit) < 0.1) { return; }   // Don't allow throws below a certain initial speed
    vInit = Math.max(-5.0, Math.min(vInit, 5.0));      // Clip the initial speed to a reasonable range
    
    if (_.isUndefined(xInit)) { xInit = contEl._gsTransform.x; }
    throw_.lastRefresh = xInit;
    decel = vInit > 0 ? 0.001 : -0.001;                // in px / ms^2
    duration = vInit / decel;                          // in ms
    throwDistance = (vInit * vInit) / (2 * decel);     // in px
    
    throw_.tween = TweenLite.to(self.$cont, duration / 1000.0, {
      x: xInit + throwDistance,
      ease: Power1.easeOut,
      onUpdate: function() {
        var x = contEl._gsTransform.x;
        self._setPosFromX(x);
        if (Math.abs(x - throw_.lastRefresh) > 1000) { throw_.lastRefresh = x; self.fixTrackTiles(); }
      },
      onComplete: function() {
        var x = contEl._gsTransform.x;
        self._setPosFromX(x);
        self.fixTrackTiles();
      }
    });
  },
  
  stopThrow: function() {
    var tween = this.throw && this.throw.tween;
    if (tween && tween.isActive()) { this.fixTrackTiles(); tween.kill(); }
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
    
    // Check occlusion of other labels and set the appropriate classes so they are visible thru the firstLabel
    // We take pains to avoid calling .offset(), because that triggers a re-layout (expensive!)
    dragContLeft = parseInt(self.$cont.get(0).style.left, 10);
    predictedWidth = label.n.length * 19;
    $elem.find('.browser-track-ruler .label').each(function() {
      var thisLeft = dragContLeft + parseInt(this.style.left, 10),
        thisWidth = $(this).text().length * 19,
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