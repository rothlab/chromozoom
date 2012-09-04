(function($){
  
  // ==================================================================================
  // = The following are helper functions used widely throughout the rest of the code =
  // ==================================================================================
  
  // Pads a number with front-leading 0's to given length
  function pad(number, length) {
    var str = '' + number;
    while (str.length < length) { str = '0' + str; }
    return str;
  }

  // Turns an arbitrary string into something that can be used as an element's class
  function classFriendly(val) { return val.toString().replace(/[^_a-zA-Z0-9-]/g, '-'); }
  
  // Mostly for debugging; show the fps in the bottom-right corner of the browser
  function fps(a, b, c) {
    $('#fps').text(a + ' ' + floorHack(1000/b) + ' ' + floorHack(c*10)/10 + ' ' + $('#browser *').length);
  }
  
  // A simplistic hash function for quickly turning strings into numbers
  function shortHash(str) {
    var hash = 0;
    if (str.length == 0) return hash;
    for (i = 0; i < str.length; i++) {
      chr = str.charCodeAt(i);
      hash = ((hash<<5)-hash)+chr;
      hash = hash & hash;
    }
    return hash;
  }
  
  // Get the last name in a path-like string (after the last slash/backslash)
  function basename(path) { return path.replace(/^.*[\/\\]/g, ''); };
  
  // Faster than Math.floor (http://webdood.com/?p=219)
  function floorHack(num) { return (num << 0) - (num < 0 ? 1 : 0); }
  
  // Decode characters that are safe within our query strings, for increased readability
  function decodeSafeOctets(query) {
    var safe = {'3A': ':', '40': '@', '7C': '|', '2F': '/'};
    return query.replace(/%([0-9A-F]{2})/gi, function(m, oct) { return safe[oct] || m; });
  }
  
  // Make a unique ID for an arbitary element, using the given prefix string
  $.uniqId = function(prefix, alsoDisallow) {
    var rand = function() { return floorHack(Math.random()*1000000); };
    var num = rand();
    while ((alsoDisallow && alsoDisallow[num]) || $('#'+prefix+'-'+num).length) { num = rand(); }
    return prefix+'-'+num;
  };

  // Make a new element (faster than $("<elem/>"))
  $.mk = function(NS, elem) { 
    return (elem && document.createElementNS) ? $(document.createElementNS(NS, elem)) 
      : $(document.createElement(elem = NS)); 
  }

  // Escape something so it can be inserted into a regular expression
  RegExp.quote = function(str) { return str.replace(/([.?*+^$[\]\\(){}-])/g, "\\$1"); };

  // ================================================================
  // = The following are short jQuery extensions used by chromozoom =
  // ================================================================

  // jQuery Hotkeys Plugin, copyright 2010, John Resig
  // Dual licensed under the MIT or GPL Version 2 licenses
  // https://github.com/jeresig/jquery.hotkeys
  (function($) {
    $.hotkeys = {
      version: "0.8",

      specialKeys: {
        8: "backspace", 9: "tab", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
        20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
        37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 
        96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
        104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/", 
        112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8", 
        120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 191: "/", 224: "meta"
      },

      shiftNums: {
        "`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", 
        "8": "*", "9": "(", "0": ")", "-": "_", "=": "+", ";": ": ", "'": "\"", ",": "<", 
        ".": ">",  "/": "?",  "\\": "|"
      }
    };

    function keyHandler( handleObj ) {
      // Only care when a possible input has been specified
      if ( typeof handleObj.data !== "string" ) {
        return;
      }

      var origHandler = handleObj.handler,
        keys = handleObj.data.toLowerCase().split(" ");

      handleObj.handler = function( event ) {
        // Don't fire in text-accepting inputs that we didn't directly bind to
        if ( this !== event.target && (/textarea|select/i.test( event.target.nodeName ) ||
           event.target.type === "text") ) {
          return;
        }

        // Keypress represents characters, not special keys
        var special = event.type !== "keypress" && $.hotkeys.specialKeys[ event.which ],
          character = String.fromCharCode( event.which ).toLowerCase(),
          key, modif = "", possible = {};

        // check combinations (alt|ctrl|shift+anything)
        if ( event.altKey && special !== "alt" ) {
          modif += "alt+";
        }

        if ( event.ctrlKey && special !== "ctrl" ) {
          modif += "ctrl+";
        }

        // TODO: Need to make sure this works consistently across platforms
        if ( event.metaKey && !event.ctrlKey && special !== "meta" ) {
          modif += "meta+";
        }

        if ( event.shiftKey && special !== "shift" ) {
          modif += "shift+";
        }

        if ( special ) {
          possible[ modif + special ] = true;

        } else {
          possible[ modif + character ] = true;
          possible[ modif + $.hotkeys.shiftNums[ character ] ] = true;

          // "$" can be triggered as "Shift+4" or "Shift+$" or just "$"
          if ( modif === "shift+" ) {
            possible[ $.hotkeys.shiftNums[ character ] ] = true;
          }
        }

        for ( var i = 0, l = keys.length; i < l; i++ ) {
          if ( possible[ keys[i] ] ) {
            return origHandler.apply( this, arguments );
          }
        }
      };
    }

    $.each([ "keydown", "keyup", "keypress" ], function() {
      $.event.special[ this ] = { add: keyHandler };
    });
  })($);

  // jQuery sortElements by James Padolsey, dual licensed MIT/GPL
  // Found at https://github.com/padolsey/jQuery-Plugins/tree/master/sortElements/
  $.fn.sortElements = (function(){
    var sort = [].sort;
    return function(comparator, getSortable) {
      getSortable = getSortable || function(){return this;};
      var placements = this.map(function(){
        var sortElement = getSortable.call(this),
          parentNode = sortElement.parentNode,
          // Since the element itself will change position, we have
          // to have some way of storing its original position in
          // the DOM. The easiest way is to have a 'flag' node:
          nextSibling = parentNode.insertBefore(
            document.createTextNode(''),
            sortElement.nextSibling
          );
        return function() {
          if (parentNode === this) {
            throw "You can't sort elements if any one is a descendant of another.";
          }
          // Insert before flag:
          parentNode.insertBefore(this, nextSibling);
          // Remove flag:
          parentNode.removeChild(nextSibling);
        };
      });

      return sort.call(this, comparator).each(function(i){
        placements[i].call(getSortable.call(this));
      });
    };
  })();

  // jQuery Cookie Plugin, found at https://github.com/carhartl/jquery-cookie
  // Copyright 2011, Klaus Hartl
  // Dual licensed under the MIT or GPL Version 2 licenses.
  (function($) {
    $.cookie = function(key, value, options) {
      // key and at least value given, set cookie...
      if (arguments.length > 1 && (!/Object/.test(Object.prototype.toString.call(value)) || value === null || value === undefined)) {
        options = $.extend({}, options);

        if (value === null || value === undefined) {
          options.expires = -1;
        }

        if (typeof options.expires === 'number') {
          var days = options.expires, t = options.expires = new Date();
          t.setDate(t.getDate() + days);
        }

        value = String(value);

        return (document.cookie = [
          encodeURIComponent(key), '=', options.raw ? value : encodeURIComponent(value),
          // use expires attribute, max-age is not supported by IE
          options.expires ? '; expires=' + options.expires.toUTCString() : '',
          options.path    ? '; path=' + options.path : '',
          options.domain  ? '; domain=' + options.domain : '',
          options.secure  ? '; secure' : ''
        ].join(''));
      }

      // key and possibly options given, get cookie...
      options = value || {};
      var decode = options.raw ? function(s) { return s; } : decodeURIComponent;

      var pairs = document.cookie.split('; ');
      for (var i = 0, pair; pair = pairs[i] && pairs[i].split('='); i++) {
        // IE saves cookies with empty string as "c; ", e.g. without "=" as opposed to EOMB, thus pair[1] may be undefined
        if (decode(pair[0]) === key) return decode(pair[1] || '');
      }
      return null;
    };
  })(jQuery);

  // http://stackoverflow.com/questions/901115/get-query-string-values-in-javascript
  $.urlParams = function() {
    var p = {},
      e,
      a = /\+/g,  // Regex for replacing addition symbol with a space
      r = /([^&=]+)=?([^&]*)/g,
      d = function (s) { return decodeURIComponent(s.replace(a, " ")); },
      q = window.location.search.substring(1);

    while (e = r.exec(q)) { 
      var k = d(e[1]), v = d(e[2]); 
      p[k] = p[k] ? (_.isArray(p[k]) ? p[k].push(v) : [p[k], v]) : v; 
    }
    return p;
  };

  /****************************************************************************************/
  //
  // Code that is particular to chromozoom begins here
  // We have three widgets that are built on the jQuery UI $.widget framework
  //    1) $.ui.genobrowser
  //    2) $.ui.genoline
  //    3) $.ui.genotrack
  //
  /****************************************************************************************/

  // =======================================================================================
  // = $.ui.genobrowser is the central widget that coordinates the front-end of chromozoom =
  // =======================================================================================

  $.widget('ui.genobrowser', {

    // Default options that are overridden by the genome JSON configuration when this widget is instantiated
    options: {
      disabled: false,
      betweenLines: 20,
      tileWidth: 1000,
      genome: 'hg18',
      genomeSize: 3080419480,
      sideBarWidth: 100,
      tracks: [
        {n:'ruler', h:50, s:['dense']}
      ],
      chrOrder: [],
      chrLengths: {},
      chrBands: [],
      availTracks: [],
      tileDir: 'o/',
      ajaxDir: 'php/',
      bppps: [2.9e5],
      overzoomBppps: [],
      initZoom: 2.9e5,
      ideogramsAbove: 3.3e4,
      bpppNumbersBelow: [3.3e4, 3.3e3],
      ntsBelow: [1, 0.1],
      navBar: '#navbar',
      footerBar: '#footerbar',
      zoomSlider: '#zoom',
      zoomBtns: ['#zoom-in', '#zoom-out'],
      trackPicker: ['#tracks', '#track-picker', '#custom-tracks', '#custom-picker'],
      jump: ['#loc', '#jump', '#loc-picker'],
      genomePicker: ['#genome', '#genome-picker'],
      lineMode: '#line-mode',
      linking: ['#linking', '#link-picker'],
      overlay: ['#overlay', '#overlay-message'],
      lineFixDuration: 500,
      reticOpacity: 0.8,
      verticalDragDeadZone: 12,
      maxNtRequest: 20000,
      dialogs: ['#quickstart', '#about', '#old-msie'],
      ucscURL: 'http://genome.ucsc.edu/cgi-bin/hgTracks',
      trackDescURL: 'http://genome.ucsc.edu/cgi-bin/hgTrackUi',
      bpppFormat: function(bppp) { return bppp.toExponential(2).replace(/(\+|-)(\d)$/, '$10$2'); },
      useCanvasTicks: true,
      savableParams: {session: ['position', 'tracks'], persistent: ['mode']}
      //,snapZoom: true
      //,snapZoomAfter: 200
    },

    // ====================================================================
    // = The following _init functions handle instantiation-related tasks =
    // ====================================================================

    // Called automatically when widget is instantiated
    _init: function() {
      var self = this,
        $elem = self.element, 
        o = self.options,
        p = 0,
        chrPos = {};
      
      // Setup internal variables related to chromosome bands, lengths, and available tracks
      self.chrPos = {};
      o.chrLabels = [];
      _.each(o.chrOrder, function(v){ o.chrLabels.push({p: p, n: v}); self.chrPos[v] = p; p += o.chrLengths[v]; });
      _.each(o.chrBands, function(v){ v[5] = v[1]; v[1] += self.chrPos[v[0]]; v[2] += self.chrPos[v[0]]; });
      self.availTracks = {};
      self.defaultTracks = [];
      _.each(o.availTracks, function(v) { self.availTracks[v.n] = v; });
      _.each(o.tracks, function(t){ 
        $.extend(t, self.availTracks[t.n]);
        self.defaultTracks.push({n: t.n, h: t.h});
      });
      
      // Setup remaining internal variables
      self.$lines = $elem.children('.browser-line');
      self.pos = 1; // this is the bp position of the left side of the top line
      self.bppp = o.initZoom;
      self._densityOrder = {};
      self._densityOrderFor = {};
      self._areaIndex = {};
      self._areaHover = null;
      self._tileFixingEnabled = true;
      self._showReticle = {mouseArea: false, dragging: false, hotKeys: false};
      self._defaultLineMode = $(o.lineMode).find(':checked').val();
      
      // Initialize some of the navbar widgets
      self.$slider = self._initSlider();
      self.$trackPicker = self._initTrackPicker();
      self.$customTracks = self._initCustomTracks();
      self.$links = self._initLinking();
      
      // Debounce some of the handler functions; this prevents it from firing more than once per X milliseconds
      // This cuts down on the load of some of the more expensive actions
      self._finishZoomDebounced = _.debounce(self._finishZoomDebounced, o.snapZoomAfter || 500);
      self._updateReticleDebounced = _.debounce(self._updateReticle, o.snapZoomAfter || 500);
      self._normalizePosDebounced = _.debounce(self.normalizePos, 200);
      self._fixZoomedTrackDebounced = _.debounce(self._fixZoomedTrackDebounced, 500);
      self._fixClickAreasDebounced = _.debounce(self._fixClickAreasDebounced, 500);
      self._saveParamsDebounced = _.debounce(self._saveParamsDebounced, 500);
      
      // Bind event handlers for the window and main widgets
      $(window).resize(function(e, callback) { 
        if (this == e.target) { 
          self._width = $elem.width();
          self._fixNumLines(null, {duration: 0, complete: callback});
          $(o.navBar).toggleClass('narrow', self._width < 950).find('.picker ul').css('max-height', $elem.height() - 20);
        }
      });
      $(document).bind('DOMMouseScroll mousewheel', _.bind(self._recvZoom, self));
      $(o.zoomBtns[0]).click(function() { delete self.centeredOn; self._animateZoom(true, 1000); });
      $(o.zoomBtns[1]).click(function() { delete self.centeredOn; self._animateZoom(false, 1000); });
      $elem.mouseenter(function() { self.showReticle('mouseArea', false); });
      $elem.mouseleave(function() { self.showReticle('mouseArea', true); });
      $(o.lineMode).buttonset().click(function() { self._fixNumLines(self.centralLine); });
      $(o.lineMode).find('input,a').focus(function() { var $t = $(this); _.defer(function() { $t.blur(); }); });
      $elem.bind('trackload', _.bind(self._recvTrackLoad, self));
      $(window).bind('popstate', function() { self._initFromParams(null, true); });
      
      // Initialize the footer, the search bar, hotkeys, the AJAX proxy, mobile interactions, IE fixes
      // Finally, apply params from either the URL or the session state
      self._initFooter();
      self._initJump();
      self._initHotkeys();
      self._initAjax();
      self._initMobileFeatures();
      if ($.browser.msie) { self._initIEFixes(); }
      $(window).trigger('resize', function() { self._initFromParams(null, true); });
    },
    
    _initSlider: function() {
      var self = this,
        o = this.options;
      if (!o.overzoomBppps) { o.overzoomBppps = []; }
      
      var $slider = $(o.zoomSlider),
        numBppps = o.bppps.length + o.overzoomBppps.length,
        sliderWidth = (numBppps - 1) * 10,
        sliderBppps = (self.sliderBppps = o.bppps.concat(o.overzoomBppps));
        prevVals = [];
      
      function start(e, ui) { delete self.centeredOn; };
      function slide(e, ui) {
        var idx = floorHack(ui.value),
          frac = ui.value - idx,
          zoom, k;
        // Using the arrow keys with the slider focused should animate between optimal levels
        if (e.originalEvent && e.originalEvent.type=="keydown" && (k = e.originalEvent.keyCode)) {
          if (k >= 37 && k <= 40) { self._animateZoom(k == 38 || k == 39, 1000); return; }
        }
        prevVals = prevVals.concat([ui.value]).slice(-2);
        if (frac === 0.0) { self._zoom(sliderBppps[idx]); }
        else { self._zoom((sliderBppps[idx + 1] - sliderBppps[idx]) * frac + sliderBppps[idx]); }
      };
      function stop(e, ui) {
        if (e.originalEvent && e.originalEvent.type=="keyup") { return; }
        var direction = prevVals[0] < ui.value;
        o.snapZoomAfter && _.defer(function() { self._animateZoom(direction); });
      };
      
      var $ticks = $('<div class="ticks"/>').appendTo($slider.parent());
      $ticks.html(new Array(numBppps + 1).join('<div class="tick"/>'));
      $slider.parent().width(sliderWidth);
      return $slider.width(sliderWidth).slider({
        min: 0,
        max: numBppps - 1,
        step: 0.02,
        value: _.indexOf(sliderBppps, o.initZoom),
        slide: slide,
        change: slide,
        start: start,
        stop: stop
      });
    },
    
    // Utility function to a bind a button to toggling visibility of a slide-out menu, called a "picker"
    _createPicker: function($btn, $picker, $done) {
      var closePicker = function() { $picker.slideUp(100); }
      $btn.click(function() {
        if (!$picker.is(':visible')) {
          $('body').bind('mousedown.picker', function(e) { 
            if ($(e.target).closest($picker.add($btn)).length) { return; }
            closePicker();
            $('body').unbind('mousedown.picker');
          });
          if ($btn.is('a.ui-button')) { $btn.addClass('ui-state-active'); }
        }
        $picker.slideToggle(100); 
      });
      if ($done) { $done.click(closePicker); }
      return $picker;
    },
    
    _initFooter: function() {
      var self = this,
        $elem = self.element,
        o = self.options,
        $foot = $(o.footerBar),
        $genome = $(o.genomePicker[0]),
        $genomePicker = $(o.genomePicker[1]),
        $ul = $('<ul/>').appendTo($genomePicker),
        $title = $genome.find('.title'),
        genomes = _.reject(_.keys(o.genomes), function(k) { return k == o.genome || (/^_/).test(k); }),
        $toggleBtn = $genome.children('input').eq(0),
        speciesParenthetical = o.species.match(/\((.+)\)/);
      
      // Initialize the genome picker
      self._defaultTitle = window.document.title;
      window.document.title = o.species + ' - ' + self._defaultTitle;
      $title.text(o.species.replace(/\s+\(.*$/, ''));
      if (speciesParenthetical) { $('<em class="parenth" />').text(', ' + speciesParenthetical[1]).appendTo($title); }
      $genome.find('.description').text(o.assemblyDate + ' (' + o.genome + ')');
      if (genomes.length > 0) {
        _.each(genomes, function(k) {
          var v = o.genomes[k],
            $a = $('<a class="clickable"/>').attr('href', './?db='+k).appendTo($('<li class="choice"/>').appendTo($ul));
          $('<span class="name"/>').text(v.species).appendTo($a);
          $('<span class="long-desc"/>').text(v.assemblyDate + ' (' + k + ')').appendTo($a);
          $a.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
        });
      } else {
        $('<li class="thats-it"/>').text('No other genomes available').appendTo($ul);
      }
      self._createPicker($toggleBtn, $genomePicker);
      
      // Setup the dialogs that appear upon clicking footerbar links
      _.each(o.dialogs, function(id) {
        $foot.find('a[href='+id+']').click(function() { 
          var $dialog = $(id).closest('.ui-dialog');
          $('.ui-dialog').hide();
          $dialog.addClass('visible').show();
          $dialog.find('a[href^="http://"]').attr('target', '_blank');
          $dialog.css('top', Math.max(($elem.parent().innerHeight() - $dialog.outerHeight()) * 0.5, 30));
        });
        $(id).closest('.ui-dialog').find('.ui-dialog-buttonpane button').button().click(function() {
          $(this).closest('.ui-dialog').fadeOut();
        });
      });
      
      // Show the quickstart screen if the user has never been here before and the viewport is big enough to show it
      if ($.cookie('db')===null && $(window).width() > 600 && $(window).height() > 420) { 
        $foot.find('a[href="'+o.dialogs[0]+'"]').click();
      }
    },
        
    _initTrackPicker: function() {
      var self = this,
        o = self.options,
        d = o.trackDesc,
        $toggleBtn = $(o.trackPicker[0]),
        $trackPicker = $(o.trackPicker[1]),
        $ul = $('<ul/>').appendTo($trackPicker),
        $div = $('<div class="button-line"/>').appendTo($trackPicker),
        $reset = $('<input type="button" name="reset" value="reset"/>').appendTo($div),
        $b = $('<input type="button" name="done" value="done"/>').appendTo($div);
      _.each(self.availTracks, function(t, n) {
        var $l = $('<label class="clickable"/>').appendTo($('<li class="choice"/>').appendTo($ul)),
          $c = $('<input type="checkbox"/>').attr('name', n).prependTo($l),
          $d = $('<div class="desc"></div>').appendTo($l),
          href = o.trackDescURL + '?db=' + o.genome + '&g=' + n + '#TRACK_HTML',
          $a = d[n].lg ? $('<a class="more" target="_blank">more info&hellip;</a>').attr('href', href) : '';
        $('<h3/>').addClass('name').text(d[n].sm).append($a).appendTo($d);
        if (d[n].lg) { $('<p/>').addClass('long-desc').text(d[n].lg).appendTo($d); }
        if (_.find(o.tracks, function(trk) { return trk.n==n; })) { $c.attr('checked', true); }
        $l.bind('click', function(e) { if ($(e.target).is('a')) { e.stopPropagation(); }});
        $l.attr('title', n);
        $l.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
        $c.bind('change', _.bind(self._fixTracks, self));
      });
      if (o.tracks.length === 1) { $ul.find('input[name='+o.tracks[0].n+']').attr('disabled', true); }
      $reset.click(function(e) { self._resetToDefaultTracks(); });
      return self._createPicker($toggleBtn, $trackPicker, $b).hide();
    },
    
    _initCustomTracks: function() {
      var self = this,
        $elem = self.element,
        o = self.options,
        fileInputHTML = '<input type="file" name="customFile"/>',
        urlInputHTML = '<input type="url" name="customUrl" class="url"/><input type="button" name="customUrlGet" value="go!"/>',
        $toggleBtn = $(o.trackPicker[2]),
        $picker = $(o.trackPicker[3]).hide(),
        $ul = $('<ul/>').prependTo($picker),
        $add = $picker.find('.form-line').first(),
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        browserOpts = {
          bppps: o.bppps,
          chrPos: self.chrPos,
          chrLengths: o.chrLengths,
          genomeSize: o.genomeSize,
          ajaxDir: o.ajaxDir
        },
        $urlInput, $urlGet, $div, $b, $reset;
      
      self._customTrackUrls = {
        requested: [],
        processing: [],
        loaded: []
      };
      
      function customTrackError(e) {
        $picker.find('.spinner').hide();
        var msg = e.message.replace(/^Uncaught Error: /, '');
        alert('Sorry, an error occurred while adding this custom track file:\n\n' + msg);
        // TODO: replace this with something more friendly.
        replaceFileInput(); 
      }
      
      function closePicker() { $picker.slideUp(100); }
      
      function handleFileSelect(e) {
        var reader = new FileReader(),
          $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner').show();
        if (e.target.files.length) {
          reader.onload = (function(f) {
            return function(ev) {
              CustomTracks.parseAsync(ev.target.result, browserOpts, function(tracks) {
                $spinner.hide();
                self._addCustomTracks(f.name, tracks);
              });
            };
          })(e.target.files[0]);
          reader.readAsText(e.target.files[0]);
        }
        replaceFileInput();
      }
      if (window.File && window.FileReader && window.FileList) {
        $add.find('label').html(fileInputHTML);
        $add.find('[name=customFile]').change(handleFileSelect);
        $add = $add.nextAll('.form-line').first();
      } else {
        $add.remove();
        $picker.find('.help-line').first().remove();
        $add = $picker.find('.form-line').first();
      }
      
      function replaceFileInput() {
        _.defer(function() {
          $picker.find('[name=customFile]').replaceWith(fileInputHTML);
          $picker.find('[name=customFile]').change(handleFileSelect);
        });
      }
      
      function handlePastedData(e) {
        var $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner').show();
        CustomTracks.parseAsync($add.find('textarea').val(), browserOpts, function(tracks) {
          $spinner.hide();
          self._addCustomTracks(_.uniqueId('pasted_data_'), tracks);
          $add.find('textarea').val('');
        });
      }
      function pasteAreaFocus(e) {
        var $this = $(this), height = $this.height();
        if (!$this.data('origHeight')) { $this.data('origHeight', $this.height()); }
        $this.animate({height: 120}, 200, 'easeInOutQuart');
      }
      function pasteAreaBlur(e) { $(this).animate({height: $(this).data('origHeight')}, 200, 'easeInOutQuart'); }
      $add.find('[name=customPasteAdd]').click(handlePastedData);
      $add.find('textarea').focus(pasteAreaFocus).blur(pasteAreaBlur);
      $add = $add.nextAll('.form-line').first();
      
      function handleUrlSelect(e) {
        var $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner'),
          $url = $add.find('[name=customUrl]'),
          url = $.trim($url.val());
        if (!url.length) { return; }
        $spinner.show();
        self._customTrackUrls.requested = _.without(self._customTrackUrls.requested, url);
        self._customTrackUrls.processing = _.union(self._customTrackUrls.processing, [url]);
        $.ajax(url, {
          success: function(data) {
            CustomTracks.parseAsync(data, browserOpts, function(tracks) {
              $spinner.hide();
              $url.val('');
              self._customTrackUrls.loaded = _.union(self._customTrackUrls.loaded, [url]);
              self._addCustomTracks(basename(url), tracks);
              $overlay.add($overlayMessage).fadeOut();
            });
          },
          error: function() {
            $overlay.hide();
            $overlayMessage.hide();
            customTrackError({message: "No valid custom track data was found at this URL."}); 
          }
        });
      }
      $add.find('label').html(urlInputHTML);
      $add.find('[name=customUrlGet]').click(handleUrlSelect);
      $add.find('[name=customUrl]').bind('keydown', function(e) { if (e.which==13) { handleUrlSelect(e); } });
      
      // Redefine the CustomTracks error handler so the user can see parse errors for their custom track(s).
      CustomTracks.error = customTrackError;
      
      $div = $('<div class="button-line"/>').appendTo($picker);
      $reset = $('<input type="button" name="reset" value="reset"/>').appendTo($div);
      $b = $('<input type="button" name="done" value="done"/>').appendTo($div);
      $reset.click(function(e) { self._resetCustomTracks(); });

      return self._createPicker($toggleBtn, $picker, $b);
    },
    
    _initLinking: function() {
      var self = this,
        o = self.options,
        $linkBtn = $(o.linking[0]),
        $linkPicker = $(o.linking[1]),
        $url = $linkPicker.find('.url');
      $linkBtn.button().click(function(e) { _.defer(function () { $url.select().focus(); }); return false; });
      self._createPicker($linkBtn, $linkPicker);
    },
    
    _initJump: function() {
      var self = this,
        o = self.options,
        $loc =  $(o.jump[0]),
        $jump = $(o.jump[1]);
      self.$choices = $(o.jump[2]).hide();
      function jumpToSubmit() {
        var $suggest = self.$choices.find('.focus');
        if ($suggest.length) { $suggest.click(); }
        else { self.jumpTo($loc.val()); }
      }
      $jump.click(jumpToSubmit);
      $loc.keydown(function(e) {
        if (e.which == 13) { jumpToSubmit(); }
        else if (e.which == 40) { 
          self.$choices.find('.focus').nextAll('.choice').eq(0).trigger('fakefocus');
          return false;
        } else if (e.which == 38) { 
          self.$choices.find('.focus').prevAll('.choice').eq(0).trigger('fakefocus');
          return false;
        } else {
          self._normalizePosDebounced();
        }
      });
      $loc.keyup(function(e) { _.defer(function() { ($loc.val()==='') && self._searchFor(''); }); });
    },
    
    _initHotkeys: function() {
      var self = this,
        o = this.options,
        $elem = self.element,
        motionOpts = {dir: 0},
        l = 500,
        shiftEverything = 'shift+down shift+s shift+up shift+w shift+left shift+a shift+right shift+d',
        motionInterval;
      self._keyedOffset = 0;
      // quadratic motion with an upper bound on the velocity after l milliseconds
      function x(t) { return (t > l ? 2 * l * t - l * l : t * t) / 1500; }
      function motion() {
        var now = (new Date).getTime(),
          deltaY = motionOpts.dir * x(now - motionOpts.start) - motionOpts.prev;
        self._keyedOffset -= deltaY;
        self._pos(self.pos - deltaY * self.bppp); 
        motionOpts.prev += deltaY;
      };
      $(document).bind('keydown', 'up down left right w s a d '+shiftEverything, function() { 
        self.showReticle('hotKeys', true);
        $.tipTip.hide();
        $elem.one('mousemove', function() { self.showReticle('hotKeys', false); });
      });
      $(document).bind('keydown', 'down s up w', function(e) {
        var dir = e.which == 40 || e.which == 83 ? 1 : -1; // down=>40, s=>83
        if ($(o.lineMode).find('input:checked').val() == 'single') {
          delete self.centeredOn;
          self._animateZoom(dir == -1, 1000); return false;
        }
        self._keyedOffset += dir * self.lineWidth();
        self._pos(self.pos + dir * self.bpWidth());
      });
      $(document).bind('keydown', 'left a right d', function(e) {
        var dir = e.which == 37 || e.which == 65 ? 1 : -1, // left=>37, a=>65
          now = (new Date).getTime();
        if (motionOpts.dir == dir) { return; }
        clearInterval(motionInterval);
        motionOpts = {dir: dir, start: now, prev: 0};
        motionInterval = setInterval(motion, 13); // based off of jQuery's .animate interval
      });
      $(document).bind('keyup', 'left a right d', function(e) {
        var dir = e.which == 37 || e.which == 65 ? 1 : -1;
        if (motionOpts.dir == dir) { clearInterval(motionInterval); motionOpts.dir = 0; }
      });
      $(document).bind('keydown', shiftEverything, function(e) {
        delete self.centeredOn;
        self._animateZoom(_.include([38, 87, 39, 68], e.which), 1000); // up=>38, w=>87, right=>39, d=>68
      });
      $(document).bind('keydown', 'esc', function(e) {
        var $pickers = $(o.trackPicker[1] + ',' + o.trackPicker[3]);
        $pickers.each(function() { if ($(this).is(':visible')) $(this).find('input[name=done]').click(); });
      });
    },
    
    _initAjax: function() {
      var options = this.options;
      // proxy external URLs through our local AJAX proxy
      $.ajax = (function(_ajax){
        var protocol = location.protocol,
          hostname = location.hostname,
          exRegex = RegExp(protocol + '//' + hostname),
          proxyURL = options.ajaxDir + 'proxy.php';

        function isExternal(url) {
          return !exRegex.test(url) && (/:\/\//).test(url);
        }

        return function(url, o) {
          if ( typeof url === "object" ) {
            o = url;
            url = o.url;
          } else { o.url = url; }

          if ( (/get/i.test(o.type) || !o.type) && !/json/i.test(o.dataType) && isExternal(url) ) {
            // Manipulate options so that AJAX request gets sent to our proxy
            o.url = proxyURL;
            o.dataType = 'text';
            o.data = {
              url: url + (o.data ? (/\?/.test(url) ? '&' : '?') + jQuery.param(o.data) : '')
            };

            // Since it's a JSONP request
            // complete === success
            if (!o.success && o.complete) {
              o.success = o.complete;
              delete o.complete;
            }
            o.success = (function(_success){
              return function(data) {
                if (_success) {
                  // Fake XHR callback.
                  _success.call(this, data, 'success');
                }
              };
            })(o.success);
          }
          return _ajax.call(this, o);
        };
      })($.ajax);
    },
    
    _initMobileFeatures: function() {
      var self = this,
        o = self.options,
        $elems = self.element.add(o.navBar).add(o.footerBar);
      if (!$.support.touch) { return; }
      $elems.addClass('mobile');
      
      function setMobileClasses() {
        var viewportWidth = $(window).width();
        $elems.toggleClass('mobile-wide', viewportWidth <= 768 && viewportWidth > 500);
        $elems.toggleClass('mobile-medium', viewportWidth <= 500 && viewportWidth > 320);
        $elems.toggleClass('mobile-narrow', viewportWidth <= 320);
        $(o.trackPicker[0]).val(viewportWidth <= 320 ? 'show' : 'show tracks');
      }
      setMobileClasses();
      
      var cachedPageXs = {}, prevPinchWidth = null, touchTarget, center, pinchWidth;
      function getPageX(e, identifier) {
        var pageX, changed = _.find(e.changedTouches, function(t) { return t.identifier == identifier; });
        if (changed) { pageX = changed.pageX; }
        else {
          if (!_.isUndefined(cachedPageXs[identifier])) { pageX = cachedPageXs[identifier]; }
          else { pageX = _.find(e.touches, function(t) { return t.identifier == identifier; }).pageX; }
        }
        cachedPageXs[identifier] = pageX;
        return pageX;
      }
      $(document).bind('touchstart', function(e) {
        var dragContTouch = _.find(e.originalEvent.touches, function(t) { return $(t.target).closest('.drag-cont').length > 0; });
        if (dragContTouch) { touchTarget = $(dragContTouch.target).closest('.drag-cont'); }
      });
      $(document).bind('touchmove', function(e) {
        var oe = e.originalEvent;
        // If nothing started within a draggable track area, we don't care about this event
        if (!touchTarget) { return; }
        // We're only handling pinch events here
        if (oe.touches.length != 2) { return; }
        if (center === null) {
          center = (oe.touches[0].pageX + oe.touches[1].pageX) * 0.5;
        }
        pinchWidth = Math.abs(getPageX(oe, oe.touches[0].identifier) - getPageX(oe, oe.touches[1].identifier));
        if (prevPinchWidth) {
          var delta = (pinchWidth / prevPinchWidth - 1) * 50, 
            // TODO: delta could probably be tweaked to proviude perfect positional zooming
            fakeEvent = {target: touchTarget, originalEvent: {srcElement: touchTarget, pageX: center}};
          // Simulate the equivalent mousewheel event
          self._recvZoom(fakeEvent, delta);
        }
        prevPinchWidth = pinchWidth;
      });
      $(document).bind('touchend', function(e) { cachedPageXs = {}; prevPinchWidth = touchTarget = center = null; });

      $(o.lineMode).find('input[value=single]').attr('checked', true);
      $(window).bind('orientationchange', function() { setMobileClasses(); $(window).resize(); });
    },
    
    _initIEFixes: function() {
      var self = this,
        o = self.options,
        $elems = self.element.add(o.navBar);
      $elems.addClass('msie');
      $(o.zoomSlider).parent().find('.tick').last().addClass('last');
      $(o.trackPicker[3]).find('textarea.paste').css('white-space', 'pre-wrap').attr('wrap', 'off');
      
      if (parseFloat($.browser.version) >= 9.0) { return; }
      // Stuff for old MSIE's (< MSIE 9)
      // Show the warning dialog
      $(o.footerBar).find('a[href="#old-msie"]').click();
      // Disable multiline mode
      $(o.lineMode).find('input[value=single]').attr('checked', true);
      // Old IE's have issues with creating new tabs when clicking features
      self.element.click(function(e) {
        var $a = $(e.target);
        if (e.target.nodeName.toLowerCase() == 'a' && $a.hasClass('area')) {
          var href = $a.attr('href');
          if (href) { window.location.href = href; }
        }
      });
    },
    
    _initFromParams: function(params, suppressRepeat) {
      var self = this,
        o = self.options,
        $elem = self.element,
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        $customPicker = $(o.trackPicker[3]),
        $urlInput = $customPicker.find('[name=customUrl]'),
        $urlGet = $customPicker.find('[name=customUrlGet]'),
        sessionVars = {},
        trackSpec;
      
      function persistentCookie(k, v) { $.cookie(k, v, {expires: 60}); }
      function removeCookie(k) { $.cookie(k, null); }
      persistentCookie('db', o.genome);
      self.storage = {
        session: window.sessionStorage || {setItem: $.cookie, getItem: $.cookie, removeItem: removeCookie},
        persistent: window.localStorage || {setItem: persistentCookie, getItem: $.cookie, removeItem: removeCookie}
      };
      _.each(o.savableParams, function(keys, dest) {
        _.each(keys, function(k) {
          var v = self.storage[dest].getItem((dest != 'persistent' ? o.genome + '.' : '') + k); 
          if (v !== null) { sessionVars[k] = v; }
        });
      });
      params = params || _.extend({}, sessionVars, $.urlParams());
      if (suppressRepeat && self._lastParams && _.isEqual(self._lastParams, params)) { return; }
      self._lastParams = _.clone(params);
      
      self._customTrackUrls.requested = _.union(self._customTrackUrls.requested, params.customTracks || []);
      var unprocessedUrls = _.difference(self._customTrackUrls.requested, self._customTrackUrls.processing);
      
      // If there are custom track URLs somewhere in the parameters that have not been processed yet...
      if (unprocessedUrls.length) {
        // they need to be loaded before we can make sense of the rest of the params
        $overlay.show();
        $overlayMessage.show().text('Loading custom track...');
        $urlInput.val(unprocessedUrls[0]); $urlGet.click();
        // This should have added the URL to self._customTrackUrls.processing, so it will not be submitted again
        self._nextDirectives = params;
      } else {
        if (params.mode) { $(o.lineMode).find('[value="'+params.mode+'"]').click(); }
        if (params.tracks) {
          trackSpec = _.map(params.tracks.split('|'), function(v) { 
            var split = v.split(':'), trk = {n: split[0]};
            if (split.length > 1 && (/^\d+$/.test(split[1]))) { trk.h = parseInt(split[1], 10); }
            return trk; 
          });
          self._fixTracks({}, trackSpec);
        }
        if (params.position) { self.jumpTo(params.position); }
      }
    },
    
    // =====================================================================================
    // = The following functions coordinate the display of browser lines ($.ui.genoline's) =
    // =====================================================================================
    
    // Fix the number of lines displayed vertically, shifting and unshifting lines to fill the vertical space
    // You can specify the line index to holdSteady (keep in roughly the same place), and animOpts for the animation
    _fixNumLines: function(holdSteady, animOpts) {
      var $elem = this.element, 
        o = this.options,
        availHeight = $elem.innerHeight(),
        lineHeight = this._lineHeight(),
        numLines = this.$lines.length,
        forceOneLine = $(o.lineMode).find(':checked').val() == 'single',
        newNumLines = forceOneLine ? 1 : Math.max(floorHack(availHeight / lineHeight), 1),
        extraSpace = availHeight - (newNumLines * lineHeight),
        extraLineHeight = extraSpace > 0 ? lineHeight + extraSpace / newNumLines : lineHeight,
        extraTopMargin = newNumLines === 1 ? Math.max((availHeight - lineHeight) / 2.0, 0) : 0,
        unShiftLines = 0, pushLines = 0,
        destIndex, currTop;
      if (!_.isUndefined(holdSteady) && holdSteady !== null) {
        if (!_.isUndefined(holdSteady.shift)) {
          unShiftLines = -holdSteady.shift;
        } else {
          currTop = this.$lines.eq(holdSteady).position().top;
          // Special case the resizing of the central line: it must stay the central line
          if (holdSteady == this.centralLine) { destIndex = Math.ceil(newNumLines / 2) - 1; }
          else {
            destIndex = _.min(_.range(newNumLines), function(i) { 
              return Math.abs(i * extraLineHeight + extraTopMargin - currTop); 
            });
          }
          unShiftLines = destIndex - holdSteady;
        }
      }
      pushLines = newNumLines - numLines - unShiftLines;
      unShiftLines > 0 ? this._addLines(-unShiftLines) : this._removeLines(unShiftLines, animOpts);
      pushLines > 0 ? this._addLines(pushLines) : this._removeLines(-pushLines, animOpts);
      this.centralLine = Math.ceil(newNumLines / 2) - 1;
      this._pos(this.pos - unShiftLines * this.bpWidth());
      // Only fire a completion callback once for the whole browser
      if (animOpts && animOpts.complete) { animOpts.complete = _.after(this.$lines.length, animOpts.complete); }
      this.$lines.each(function(i) {
        var newTop = i * extraLineHeight + extraTopMargin;
        $(this).data('naturalTop', newTop);
        if (holdSteady && holdSteady.exceptFor == this) { return; }
        $(this).animate({top: newTop}, $.extend({
          duration: o.lineFixDuration,
          queue: false,
          easing: 'easeInOutQuart'
        }, animOpts));
      });
      this._updateReticle(null, animOpts);
    },
    
    // A shortcut that pushes the lines in the display up or down
    shiftLines: function(num, exceptFor, animOpts) { this._fixNumLines({shift: num, exceptFor: exceptFor}, animOpts); },
    
    // Add num lines to the browser; they begin offscreen and must be moved into view
    // positive num adds to the end; negative num adds to the beginning
    _addLines: function(num) {
      var o = this.options,
        bpWidth = this.bpWidth(),
        origin = this.pos + (num > 0 ? this.$lines.length * bpWidth : -bpWidth),
        bpStep = num > 0 ? bpWidth : -bpWidth,
        // Can't use normal .unshift() on a jQuery object, it only has splice.
        ops = num > 0 ? ['appendTo', function(x){this.push(x);}] : ['prependTo', function(x){this.splice(0,0,x);}],
        setTop = num > 0 ? $(window).innerHeight() + o.betweenLines : -this._lineHeight(),
        $line, newOpts;
      num = Math.abs(num);
      while (num-->0) {
        $line = $('<div class="browser-line"></div>')[ops[0]](this.element);
        newOpts = $.extend({}, o, {browser: this.element, origin: origin});
        ops[1].call(this.$lines, $line.get(0));
        $line.css('top', setTop).genoline(newOpts);
        origin += bpStep;
      }
    },
    
    // Remove num lines to the browser; they fade out and are deleted from the DOM
    // positive num removes from the end; negative num removes from the beginning
    _removeLines: function(num, animOpts) {
      var o = this.options,
        bpWidth = this.bpWidth(),
        duration = animOpts && !_.isUndefined(animOpts.duration) ? animOpts.duration : o.lineFixDuration,
        index = num > 0 ? -1 : 0,
        // We can't use normal .pop() and .shift() on a jQuery object, it only has splice.
        popOrShift = num > 0 ? 
          function($a){ $a.splice($a.length-1,1); } : function($a){ $a.splice(0,1); };
      num = Math.abs(num);
      while (num-->0) {
        if (duration > 0) {
          this.$lines.eq(index).fadeOut(duration, function() { $(this).remove(); });
        } else { this.$lines.eq(index).remove(); }
        popOrShift(this.$lines);
      }
    },
    
    // Returns the elements that contain each line of the display
    lines: function() { return this.$lines; },
    
    // Returns the expected width, in pixels, of each line
    lineWidth: function() { return this._width - this.options.sideBarWidth; },
    
    // Returns the expected height, in pixels, of each line
    _lineHeight: function() {
      var o = this.options;
      return o.betweenLines + _.reduce(o.tracks, function(t, u) { return {h:t.h + u.h}; }).h;
    },
    
    // ===============================================================================================
    // = The following functions coordinate the tracks ($.ui.genotrack's) displayed within each line =
    // ===============================================================================================
    
    // Returns the current array of tracks, with all associated options, that are supposed to be displayed
    tracks: function() { return this.options.tracks; },
    
    // Ensures all lines have the right tracks, as specified by the checkboxes in the track pickers or the trackSpec
    _fixTracks: function(animOpts, trackSpec) {
      var self = this,
        o = self.options,
        $elem = self.element,
        newTracks = [],
        prevTracks = [],
        prevPos = self.pos + self._reticDelta(),
        externalTrackSpec = !!trackSpec;
      
      // Sync the trackSpec with the checkboxes in the track pickers
      // If trackSpec was not provided, this simply retrieves one from the state of the checkboxes
      trackSpec = self._trackSpec(trackSpec);
      newTracks = _.pluck(trackSpec, 'n');
      
      // First remove any tracks that are not in the new set
      o.tracks = _.filter(o.tracks, function(t) {
        var i = _.indexOf(newTracks, t.n);
        if (i !== -1) { 
          prevTracks.push(t.n);
          // Resize existing tracks if a new height is specified
          if (trackSpec[i].h) { self._resizeTrack(t.n, trackSpec[i].h, false, false); }
          return true;
        }
      });
      // Now, add any tracks that are in the new set but aren't in the old set
      _.each(newTracks, function(name, i) {
        var spec = trackSpec[i];
        if (!_.include(prevTracks, name)) { o.tracks.splice(i, 0, $.extend({}, self.availTracks[name], spec.h ? {h: spec.h} : {})); } 
      });
      
      self.$lines.genoline('fixTracks');
      self._fixNumLines(0, animOpts);
      if (prevPos < o.genomeSize && prevPos > 0 && (!animOpts || !animOpts.complete)) { self.jumpTo(prevPos); }
      if (!externalTrackSpec) { this._saveParamsDebounced(); }
    },
    
    // Resize a track to a particular height, fixing the line layout afterward unless fixNumLinesHoldingSteady is false,
    // Set animCallback to true to animate with no callback, a function to provide a callback, or false for no animation.
    _resizeTrack: function(name, height, fixNumLinesHoldingSteady, animCallback) {
      var o = this.options,
        $elem = this.element,
        trk = _.find(o.tracks, function(t) { return t.n == name; }),
        $lines = this.$lines,
        $tracks = $lines.find('.browser-track-'+name);
      animCallback = _.isFunction(animCallback) ? _.after($tracks.length, animCallback) : animCallback;
      trk.h = height;
      $tracks.genotrack('resize', height, animCallback);
      if (fixNumLinesHoldingSteady !== false) { this._fixNumLines(fixNumLinesHoldingSteady); }
      $lines.genoline('fixFirstLabel', true);
    },
    
    // Syncs a list of tracks (with heights), the trackSpec, with the checkboxes in the track pickers
    _trackSpec: function(trackSpec) {
      var self = this,
        $checkboxes = self.$trackPicker.find(':checkbox').add(self.$customTracks.find(':checkbox'));
      if (!trackSpec || !_.isArray(trackSpec) || !trackSpec.length) {
        trackSpec = [];
        $checkboxes.filter(':checked').each(function() { trackSpec.push({n: $(this).attr('name')}); });
      } else {
        // Cleanup external trackSpecs: for now, disallow dupes, and make sure all tracks actually exist
        trackSpec = _.uniq(_.filter(trackSpec, function(t) { return self.availTracks[t.n]; }), function(t) { return t.n; });
        $checkboxes.attr('checked', false);
        _.each(trackSpec, function(t) { $checkboxes.filter('[name="'+t.n+'"]').attr('checked', true); });
      }
      // if there is only one newTrack, disable the checkbox so there are always ≥1 tracks
      if (trackSpec.length === 1) { $checkboxes.filter(':checked').attr('disabled', true); }
      else { $checkboxes.attr('disabled', false); }
      return trackSpec;
    },
    
    // Resets to the default set of tracks
    _resetToDefaultTracks: function() {
      this._fixTracks(false, this.defaultTracks);
      this._saveParamsDebounced();
    },
    
    // After a custom track file is parsed, this function is called to add them to the custom track picker and each
    // browser line; they are also inserted in self.availTracks just like "normal" tracks
    _addCustomTracks: function(fname, customTracks) {
      var self = this,
        o = self.options,
        $ul = $(o.trackPicker[3]).children('ul').eq(0),
        d = o.trackDesc,
        browserDirectives = _.extend({}, customTracks.browser, self._nextDirectives || {}),
        warnings = [];
      _.each(customTracks, function(t, i) {
        var n = classFriendly('_'+fname+'_'+(t.opts.name || i)),
          newTrack = !self.availTracks[n],
          $l, $c, $d;
        if (newTrack) {
          $l = $('<label class="clickable"/>').appendTo($('<li class="choice"/>').appendTo($ul)),
          $c = $('<input type="checkbox" checked="checked"/>').attr('name', n).prependTo($l),
          $d = $('<div class="desc"></div>').appendTo($l);
          $l.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
          $l.attr('title', n);
          $c.bind('change', _.bind(self._fixTracks, self));
          $('<h3 class="name"/><p class="long-desc"/>').appendTo($d);
          if (browserDirectives.tracks) {
            // If track settings are to be applied, ensure any new custom tracks are added to them
            // This prevents new tracks from being added and then immediately hidden (confusing)
            if (!_.find(browserDirectives.tracks.split('|'), function(v) { return v.split(':')[0] == n; })) {
              browserDirectives.tracks += '|' + n;
            }
          }
        } else { $d = $ul.find('[name='+n+']').parent().children('.desc'); }
        // TODO: if the track is not new, inform that its data was replaced with the new track information
        self.availTracks[n] = {
          fh: {},
          n: n,
          h: t.heights.start,
          s: t.sizes,
          m: t.mapSizes,
          custom: t
        };
        _.each(o.bppps, function(bppp) { self.availTracks[n].fh[o.bpppFormat(bppp)] = {dense: t.heights.min}; });
        d[n] = {
          cat: fname,
          lg: t.opts.description || t.opts.name || n, 
          sm: t.opts.name || n
        };
        $d.children('h3.name').text(d[n].sm);
        $d.children('p.long-desc').text(d[n].lg && d[n].lg != d[n].sm ? d[n].lg : fname);
        if (t.warnings) { warnings.push.apply(warnings, t.warnings); }
      });
      if (warnings.length) {
        // TODO: Display warnings from custom track parsing to the user
        console.log(warnings);
      }
      self._fixTracks({complete: function() {
        // If browser directives were included, we need to obey them.
        self._nextDirectives = {};
        // Right now only position is supported.
        // TODO: other browser directives at http://genome.ucsc.edu/goldenPath/help/hgTracksHelp.html#lines
        if (_.keys(browserDirectives).length) { self._initFromParams(browserDirectives); }
      }}); 
    },
    
    // Removes all custom tracks.
    _resetCustomTracks: function() {
      $(this.options.trackPicker[3]).children('ul').children().remove();
      this._customTrackUrls.loaded = [];
      this._fixTracks();
    },
    
    // Determine for a given track and height what density is optimal for display
    densityOrder: function(track, height, bppps, force) {
      if (_.isUndefined(height) || _.isUndefined(bppps)) { return this._densityOrder[track] || null; }
      // TODO: this needs tweaking... maybe on the debounced version, exclude off-screen tiles?
      var self = this, 
        o = self.options,
        $elem = self.element,
        t = this.availTracks[track],
        base = _.find(t.s, function(v) { return !_.isArray(v); }),
        fixedHeights = t.fh[bppps.topFormatted] || (_.keys(t.fh).length && t.fh[_.last(_.keys(t.fh))]) || {},
        baseHeight = fixedHeights[base] || 15,
        orderFor = height + "|" + bppps.topFormatted,
        prevOrder = self._densityOrder[t.n],
        prevOrderFor = self._densityOrderFor[t.n],
        $unrenderedCustom = $('.browser-track-'+t.n+' canvas.tdata.unrendered'),
        forceAt = {}, //{pack: [200, -2], full: [200, -3]},  // This is causing too much thrashing with heavy custom tracks
        order = {}, heights = [], i = 0, optimum;
      if (prevOrderFor && prevOrderFor == orderFor && !force) { return; }
      if ($unrenderedCustom.length) {
        // All custom tracks should be rendered before reordering the densities.  Defer this calculation until then.
        return $unrenderedCustom.trigger('render', _.after($unrenderedCustom.length, function() { 
          self.densityOrder(track, height, bppps); 
        }));
      }
      if (height <= baseHeight + 3) {
        order[base] = 0;
        _.each(t.s, function(d) { if (_.isArray(d)) { order[d[0]] = ++i; } });
      } else {
        _.each(t.s, function(d) {
          if (_.isArray(d)) { d = d[0]; }
          if (fixedHeights[d]) { return heights.push([d, fixedHeights[d]]); }
          var $imgs = $('.browser-track-'+t.n+'>.bppp-'+classFriendly(bppps.top)+'>.tdata.dens-'+d);
          if ($imgs.find('.loading').length > 0) { orderFor = null; }
          var h = Math.max.apply(Math, $imgs.map(function() { 
            return this.naturalHeight || this.height; 
          }).get());
          heights.push([d, h]);
        });
        heights = _.map(heights, function(v) {
          var deltaY = height - v[1]; 
          v[1] = forceAt[v[0]] && height > forceAt[v[0]][0] ? forceAt[v[0]][1] : (deltaY > 0 ? deltaY * 3 : -deltaY); 
          return v; 
        });
        heights.sort(function(a,b){ return a[1] - b[1]; });
        _.each(heights, function(v) { order[v[0]] = ++i; });
        order[base] = ++i;
      }
      self._densityOrder[t.n] = order;
      self._densityOrderFor[t.n] = orderFor;
      if (prevOrder && !_.isEqual(order, prevOrder)) { 
        $elem.find('.browser-track-'+t.n).genotrack('updateDensity');
      }
    },
    
    // ================================================================================================
    // = These are navigational functions; they handle movement, zooming, position calculations, etc. =
    // ================================================================================================

    // Returns the expected width, in base pairs, of each line
    bpWidth: function() { return this.lineWidth() * this.bppp; },
    
    // Returns the chromosome that contains the given absolute bp position
    chrAt: function(pos) {
      var o = this.options,
        chrIndex = _.sortedIndex(o.chrLabels, {p: pos}, function(v) { return v.p; });
      return chrIndex > 0 ? o.chrLabels[chrIndex - 1] : null;
    },
    
    // Turns a string like "chrX:12512" into an bp position from the start of the genome
    normalizePos: function(pos, forceful) {
      var o = this.options, ret = {}, matches, end;
      ret.pos = $.trim(_.isUndefined(pos) ? $(o.jump[0]).val() : pos);
      if (ret.pos === '') { this._searchFor(''); return null; }
      matches = ret.pos.match(/^([a-z]+[a-z0-9]*)(:(\d+)(([-@])(\d+(\.\d+)?))?)?/i);
      if (matches && matches[1]) {
        var chr = _.find(o.chrLabels, function(v) { return v.n === matches[1]; });
        if (!chr) { this._searchFor(ret.pos, forceful); return null; }
        this._searchFor('', forceful);
        ret.pos = chr.p + parseInt(matches[3] || '1', 10);
          if (matches[5] == '-') {
            // Allow ranges, e.g. chrX:12512-12630
            end = chr.p + parseInt(matches[6], 10);
            if (end > ret.pos) {
              ret.bppp = (end - ret.pos) / (this.lineWidth() - o.sideBarWidth);
              // Find the nearest optimal zoom level on the slider that fully encompasses the range.
              ret.bppp = _.find(this.sliderBppps.reverse(), function(v) { return v >= ret.bppp; }) || _.last(this.sliderBppps);
              this.sliderBppps.reverse(); // .reverse() is destructive in JS -_-
              ret.pos += floorHack((end - ret.pos) / 2);
            }
          } else if (matches[5] == '@') {
            // or specifying bppp directly, e.g. chrX:12512@100
            ret.bppp = parseFloat(matches[6]);
          }
      } else { ret.pos = parseInt(pos, 10); }
      return ret;
    },
    
    // Displays the search dropdown where the user can select from features that match the query
    _searchFor: function(search, forceful) {
      var self = this,
        o = self.options,
        $elem = self.element;
      function hilite(text, searchFor) {
        return text.replace(new RegExp(RegExp.quote(searchFor), "gi"), '<span class="hilite">'+searchFor+'</span>');
      }
      function createChoice(c, cat) {
        var $c = $('<div class="choice"/>');
        $('<h3 class="name"/>').html(hilite(c.name, search)).appendTo($c);
        $('<p class="long-desc"/>').html(hilite(c.desc, search)).appendTo($c);
        $c.bind('fakefocus', function() { $(this).addClass('focus'); $(this).siblings().removeClass('focus'); });
        $c.bind('fakeblur', function() { $(this).removeClass('focus'); });
        $c.mouseover(function() { $(this).trigger('fakefocus'); });
        $c.click(function() {
          var m, picked = (m = c.desc.match(/^\((.+)\)/)) ? m[1].toLowerCase() : c.name.toLowerCase();
          $('body').unbind('mousedown.search');
          self.$trackPicker.find('input[name='+cat.track+']').attr('checked', true);
          self.tileFixingEnabled(false);
          self._fixTracks({duration: 0, complete: function() {
            // This callback maximizes the track that contained the feature clicked, and flashes the feature.
            // Flashing the clicked feature is tricky because everything is loading at different times.
            var $maximizeTrack = self.$lines.eq(self.centralLine).find('.browser-track-'+cat.track).eq(0);
            $maximizeTrack.one('trackload', function(e, bppps) {
              var $imgs = self.$lines.find('.bppp-'+classFriendly(bppps.top)+' .tdata.dens-pack');
              maxHeight = 5 + Math.max.apply(Math, $imgs.map(function() { 
                return this.naturalHeight || this.height;
              }).get());
              // After the track is resized, flash all the features that were added to our todo-list
              self._resizeTrack(cat.track, maxHeight, self.centralLine, function() {
                var $stillLoading = self.$lines.find('.browser-track-'+cat.track).has('.areas-loading');
                $elem.find('.browser-track').genotrack('updateDensity');
                function flash() { self.areaHover([cat.track, bppps.top, "pack", "name", picked], "FLASHME"); };
                // FIXME: this is pretty rickety
                if (!$stillLoading.length) { flash(); }
                else { $stillLoading.one('areaload', _.after($stillLoading.length, flash)); }
              });
            });
            _.defer(function(){ self.tileFixingEnabled(true); $elem.find('.browser-track-'+cat.track).genotrack('fixClickAreas'); });
          }});
          self.jumpTo(c.pos);
          return false; 
        });
        return $c;
      }
      function hideChoices() { self.$choices.find('.choice').trigger('fakeblur'); self.$choices.hide(); }
      
      if (search==='') { return hideChoices(); }
      if (search===self.prevSearch && !forceful) { return; }
      self.$choices.empty().addClass('loading').removeClass('no-results').slideDown();
      $('body').bind('mousedown.search', function(e) { 
        if (!$(e.target).closest(self.$choices).length) { hideChoices(); }
        $('body').unbind('mousedown.search');
      });
      if (self.currentSearch) { self.currentSearch.abort(); }
      
      self.prevSearch = search;
      self.currentSearch = $.ajax(o.ajaxDir+'search.php', {
        data: {position: search, db: o.genome},
        dataType: 'json',
        success: function(data) {
          self.$choices.removeClass('loading');
          if (data['goto']) { self.jumpTo(data['goto']); return; }
          if (data.categories.length===0) { self.$choices.addClass('no-results'); }
          var numCategories = _.keys(data.categories).length,
            choicesPerCategory = Math.max(Math.ceil(12 / numCategories), 3);
          _.each(data.categories, function(cat, catname) {
            $('<div class="choice-category"/>').text(catname).appendTo(self.$choices);
            _.each(cat.choices.slice(0, choicesPerCategory), function(c) {
              var $c = createChoice(c, cat).appendTo(self.$choices);
            });
          });
          self.$choices.find('.choice').eq(0).trigger('fakefocus');
        }
      });
    },
        
    // public (indirect) setter for this.pos; centers the reticle on reticPos
    jumpTo: function(reticPos) {
      var dest = this.normalizePos(reticPos, true);
      if (dest !== null) {
        this.$choices.hide().empty();
        if (dest.bppp) {
          this.pos = dest.pos - this._reticDelta();
          this.zoom(dest.bppp); 
        } else {
          this._pos(dest.pos - this._reticDelta());
        }
        $(this.options.jump[0]).blur();
      }
    },
    
    // private setter for this.pos that updates the UI accordingly.
    // forceRepos usually means a zoom happened, which requires that the tiles are repositioned within the tracks.
    _pos: function(pos, exceptFor, forceRepos) {
      var o = this.options,
        bpWidth = this.bpWidth(),
        rd = this._reticDelta();
      exceptFor = $(exceptFor).get(0);
      pos = _.isUndefined(pos) ? this.pos : pos;
      this.pos = pos;
      this.$lines.each(function(i) {
        if (this == exceptFor) { return; }
        $(this).genoline('jumpTo', pos + i * bpWidth, forceRepos); 
      });
      if (forceRepos) { this._fixZoomedTrackDebounced(); }
      this._fixClickAreasDebounced();
      this._saveParamsDebounced();
    },
    
    // Returns the position (in basepairs) closest to the mouse cursor
    _posAtMouse: function(e) {
      var $line = $(e.srcElement || e.originalTarget).closest('.browser-line');
      if (!$line.length) { return null; }
      return (e.pageX - this.options.sideBarWidth) * this.bppp + $line.genoline('getPos');
    },
    
    // public getter/setter for this.bppp that updates the UI.  If duration is specified, animates the change in zoom.
    zoom: function(zoom, centeredOn, duration) {
      var self = this,
        o = self.options;
      
      function sliderValue(zoom) {
        var ret = 0;
        for (var i = 0; i < self.sliderBppps.length; i++) {
          var bppp = self.sliderBppps[i];
          if (zoom > bppp) {
            var frac = zoom - bppp;
            return ret + (1.0 - frac / (self.sliderBppps[ret] - self.sliderBppps[i]));
          }
          ret = i;
        }
        return ret;
      }
      
      if (!_.isUndefined(zoom)) {
        if (!_.isUndefined(centeredOn) && centeredOn !== null) { this.centeredOn = centeredOn; }
        else { delete this.centeredOn; }
        if (!_.isUndefined(duration)) {
          this._animateZoom(_.isBoolean(zoom) ? zoom : sliderValue(zoom), duration);
        } else {
          this.$slider.slider('value', sliderValue(zoom));
        }
      }
      return this.bppp; 
    },
    
    // private setter for this.bppp; does not update the slider--used internally by it.
    _zoom: function(zoom, centeredOn) {
      centeredOn = centeredOn || this.centeredOn || (this.pos + this._reticDelta());
      var pos = centeredOn - (centeredOn - this.pos) / (this.bppp / zoom);
      this.bppp = zoom;
      var now = (new Date).getTime();
      this._pos(pos, null, true);
      fps("ZOOM", (new Date).getTime() - now, this.bppp);
      this._updateReticle(centeredOn);
    },
    
    // If "to" is boolean, true will raise the slider one step and false will lower it one step.
    _animateZoom: function(to, duration) {
      var $slider = $(this.options.zoomSlider),
        from = $slider.slider('value');
      if (_.isBoolean(to)) { to = Math[to ? 'ceil' : 'floor'](from + (to ? 0.001 : -0.001)); }
      $slider.css('text-indent', 0).animate({textIndent: 1}, {
        queue: false,
        step: function(i) { $slider.slider('value', (to - from) * i + from); },
        duration: duration || 150
      });
    },
    
    // ===================================================================================================
    // = The following functions handle or assist events sent from sub-widgets, like the lines or tracks =
    // ===================================================================================================
    
    // Returns the distance left or right, in pixels, that the lines have been shifted by the last keypress
    keyedOffset: function() { return this._keyedOffset; },
    
    // Fixing tiles can be temporarily disabled and re-enabled with this function
    tileFixingEnabled: function(set) {
      this._tileFixingEnabled = (!_.isUndefined(set) ? !!set : this._tileFixingEnabled);
      if (set) { this.$lines.genoline('fixTrackTiles', true); }
      return this._tileFixingEnabled; 
    },
    
    // Handle a drag event on one of the lines, propagating its motion to the other lines
    recvDrag: function($src, linePos) {
      var lineIndex = this.$lines.index($src),
        pos = linePos - lineIndex * this.bpWidth();
      var now = (new Date).getTime();
      this._pos(pos, $src);
      fps("MOVE", (new Date).getTime() - now, this.bppp);
    },
    
    // Handle a track resize event on one of the lines, propagating its changes to the other lines and fixing the layout
    recvTrackResize: function($src, name, height, callback) {
      var holdSteady = $src && this.$lines.index($src);
      this._resizeTrack(name, height, holdSteady, _.isFunction(callback) ? callback : true);
    },
    
    // Handle a track reorder action on one of the lines, propagating its changes to the other lines
    // newOrder is an array mapping oldIndex => newIndex
    recvSort: function($src, newOrder) {
      var o = this.options;
      _.each(o.tracks, function(v, i) { v._i = i; });
      o.tracks.sort(function(a, b) { return newOrder[a._i] - newOrder[b._i]; });
      _.each(o.tracks, function(v, i) { delete v._i; });
      this.$lines.not($src).genoline('fixTracks').genoline('fixTrackTiles');
    },
    
    // Handle a mousewheel event on one of the lines, propagating its changes to all lines.
    _recvZoom: function(e, manualDelta) {
      var self = this,
        o = this.options,
        d = [manualDelta, e.originalEvent.wheelDeltaY, e.originalEvent.wheelDelta, 
          e.originalEvent.axis == 2 && -e.originalEvent.detail],
        userAgent = navigator && navigator.userAgent,
        adjust = [[(/chrome/i), 0.1], [(/safari/i), 0.03], [(/opera|msie/i), 0.01]];
      if ($(e.target).closest('.picker').length) { return; } // You can scroll the track pickers
      self.element.find('.drag-cont').stop(); // Stop any current inertial scrolling
      if (_.isUndefined(self._wheelDelta)) { self._wheelDelta = 0; }
      $.tipTip.hide(); // Hide any tipTips showing
      d = _.reject(d, _.isUndefined).shift();
      self.centeredOn = self._posAtMouse(e.originalEvent);
      if (d && self.centeredOn !== null) {
        var value = self.$slider.slider('value'),
          delta = (o.snapZoom ? (self._wheelDelta += d) : d) / 20;
        if (userAgent && _.isUndefined(manualDelta)) { 
          _.find(adjust, function(v) { return v[0].test(userAgent) && (delta *= v[1]); }); 
        } else if (e.originalEvent.wheelDeltaY) { delta *= 0.05; }
        if (o.snapZoom) {
          if (Math.abs(delta) > 1.2) { 
            self._animateZoom(delta > 0, 1000);
            self._wheelDelta = 0;
          }
        } else { self.$slider.slider('value', value + delta); }
        self._finishZoomDebounced(delta > 0);
      }
      return false;
    },
    
    // This is fired shortly after tracks believe that all images have loaded.
    // We recalculate the density order of tracks, and fix the orange clip indicators.
    _recvTrackLoad: function(e) {
      var self = this,
        $elem = self.element,
        $trk = $(e.target),
        t = $trk.genotrack('option', 'track');
      
      // This handler is manually debounced by 100ms, separately per track.
      self._trackLoadTimers = self._trackLoadTimers || {};
      if (!_.isUndefined(self._trackLoadTimers[t.n])) { clearTimeout(self._trackLoadTimers[t.n]); }
      self._trackLoadTimers[t.n] = setTimeout(_.bind(function($trk, t) {
        // we have new image data, so *force* recalculation of the densityOrder
        self.densityOrder(t.n, t.h, $trk.genotrack('bppps'), true);
        $elem.find('.browser-track-'+t.n).genotrack('fixClipped');
      }, self, $trk, t), 100);
    },
    
    // ===============================================
    // = These functions manipulate the tank reticle =
    // ===============================================
    
    // Returns the offset of the reticle, in basepairs, from the position of the browser
    // which is designated as the basepair at the left edge of the topmost line
    _reticDelta: function(line) {
      line = _.isUndefined(line) ? this.centralLine : line;
      var bpWidth = this.bpWidth();
      return (line + 0.5) * bpWidth - this.options.sideBarWidth * 0.5 * this.bppp;
    },

    // Change the position and width of the reticle
    _updateReticle: function(centeredOn, animOpts) {
      var $elem = this.element,
        o = this.options,
        bpWidth = this.bpWidth(),
        zoom = this.bppp,
        lineIndex = _.isNumber(centeredOn) ? floorHack((centeredOn - this.pos) / bpWidth) : this.centralLine,
        nextZooms = this.sliderBppps.slice(Math.ceil(this.$slider.slider('value') + 0.001)),
        $line = this.$lines.eq(lineIndex),
        duration = animOpts && !_.isUndefined(animOpts.duration) ? animOpts.duration : 200;
      function hide($retics, d) {
        d = d || duration;
        $retics.animate({opacity: 0}, { duration: d, complete: function() { $(this).addClass('hidden'); } });
      }
      if (!nextZooms.length) { nextZooms = this.sliderBppps.slice(-1); }
      if (_.isUndefined(centeredOn)) {
        if (!_.any(this._showReticle)) { return hide($elem.find('.retic:not(.hidden)')); }
        $line.find('.retic.hidden').animate({opacity: o.reticOpacity}, {
          duration: 200, 
          complete: function() { $(this).removeClass('hidden'); }
        });
      } else {
        $line.find('.retic').css('opacity', o.reticOpacity).removeClass('hidden');
        this._updateReticleDebounced();
      }
      $line.genoline('setReticle', nextZooms, centeredOn);
      hide(this.$lines.not($line.get(0)).find('.retic:not(.hidden)'), 0);
    },
    
    // Display the reticle for one of several possible reasons (set them as true or false)
    // The reticle will be shown if any of the reasons apply
    showReticle: function(why, val) {
      this._showReticle[why] = val;
      this._updateReticle();
    },
    
    // ===================================================================================================
    // = The following functions are debounced; they update the display after a repeated event concludes =
    // ===================================================================================================
    
    // After a short delay, a zoom action can be "snapped" to the nearest optimal level
    // NOTE: This is _.debounce'd in init()
    _finishZoomDebounced: function(direction) {
      if (this.options.snapZoomAfter && !this.options.snapZoom) { this._animateZoom(direction); }
      if (this.options.snapZoom) { self._wheelDelta = 0; }
    },
    
    // Everytime we zoom in on a line, we have to recalculate the density order of tracks,
    // and redraw the tick marks on the ruler track.
    // NOTE: This is _.debounce'd in _init()
    _fixZoomedTrackDebounced: function() {
      var self = this,
        o = this.options,
        $elem = self.element;
      _.each(o.tracks, function(t) {
        self.densityOrder(t.n, t.h, $elem.find('.browser-track-'+t.n).genotrack('bppps'));
        $elem.find('.browser-track-'+t.n).genotrack('redrawCanvasTicks');
      });
    },
    
    // Remembers the general layout & position of the browser for the next time it is opened
    // NOTE: This is _.debounce'd in _init()
    _saveParamsDebounced: function() {
      var self = this,
        pos = self.pos,
        o = self.options,
        rd = self._reticDelta(),
        chr = self.chrAt(pos + rd) || o.chrLabels[0],
        zoomFormatted = self.bppp.toPrecision(Math.max(floorHack(self.bppp).toString().length, 6)),
        state = {position: chr.n + ':' + Math.round(pos + rd - chr.p) + '@' + zoomFormatted},
        lineMode = $(o.lineMode).find(':checked').val(),
        $linkPicker = $(o.linking[1]),
        $url = $linkPicker.find('.url'),
        $ucscLink = $linkPicker.find('a[name=ucsc]'),
        url, start, end, ucscParams;
      state.tracks = _.map(o.tracks, function(t) { return t.n + ':' + t.h; }).join('|');
      state.customTracks = self._customTrackUrls.loaded;
      if (lineMode != self._defaultLineMode) { state.mode = lineMode; }
      
      // $.param({...}, true) --> don't add [] to array params
      url = '?' + decodeSafeOctets($.param(_.extend({db: o.genome}, state), true));
      // If the HTML5 history API is implemented, save the state to the URL bar after the first change
      if (window.history && window.history.replaceState && self.state) {
        var now = (new Date).getTime(),
          historyFn = now - (self._histLastReplaced || 0) > 20000 ? 'pushState' : 'replaceState';
        window.history[historyFn]({}, window.document.title, url);
        self._histLastReplaced = (new Date).getTime();
      }
      $url.val(window.location.href.replace(/\?.*$/, '') + url);
      
      // Also make a URL to the equivalent view in UCSC
      start = Math.max(Math.round(pos - chr.p), 1);
      end = Math.min(Math.round(pos - chr.p + self.bpWidth() * self.$lines.length), o.chrLengths[chr.n]);
      ucscParams = {db: o.genome, position: chr.n + ':' + start + '-' + end};
      _.each(o.tracks, function(t) { 
        var densityOrderAsArray = _.map(self.densityOrder(t.n), function(v,k) { return [k,v]; });
        ucscParams[t.n] = _.min(densityOrderAsArray, function(p) { return p[1]; })[0];  
      });
      $ucscLink.attr('href', o.ucscURL + '?' + $.param(ucscParams));
      
      // Save state in localStorage, sessionStorage, and $.cookie as appropriate
      self.state = state;
      self.storage && _.each(o.savableParams, function(keys, dest) {
        _.each(keys, function(k) {
          var fullKey = (dest != 'persistent' ? o.genome + '.' : '') + k;
          if (!_.isUndefined(state[k])) { 
            self.storage[dest].setItem(fullKey, state[k]); 
          } else {
            self.storage[dest].removeItem(fullKey);
          }
        });
      });
    },
    
    // ===========================================================================================
    // = The following functions coordinate the click areas that appear when hovering over tiles =
    // ===========================================================================================
    
    // Everytime we move the browser, we have to fetch new click area data.
    // NOTE: This is _.debounce'd in _init()
    _fixClickAreasDebounced: function() {
      var self = this,
        o = this.options,
        $elem = self.element;
      _.each(o.tracks, function(t) {
        $elem.find('.browser-track-'+t.n).genotrack('fixClickAreas');
      });
    },
    
    // Areas are stored in a global index, so that mousing over an area in one tile can retrieve
    // areas with a similar name/hrefHash that must also be highlighted.  This function receives
    // information about a current hover event and creates the appropriate highlighted anchors
    // within the correct tiles. 
    areaHover: function(keys, target) {
      var $elem = this.element;
      if (_.isUndefined(keys)) { return this._areaHover; }
      $elem.find('.area.rect').remove();
      $elem.find('.area.label.hover').removeClass('hover');
      if (!keys) { $.tipTip.hide(); return (this._areaHover = false); }
      if (keys.length != 5) { throw 'not enough levels to traverse index'; }
      var areaIndices = this._areaIndex;
      // keys is used to traverse the first 5 levels of the areaIndex, which is organized as follows:
      // areaIndex[track][bppp][density]["hrefHash"|"name"][hrefHash|name][tileId][localAreaId] = true
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!areaIndices[k]) { areaIndices = false; break; }
        areaIndices = areaIndices[k];
      }
      if (areaIndices) {
        _.each(areaIndices, function(localAreaIds, tileId) {
          var $t = $('#'+tileId),
            $tdata = $t.children('.tdata.dens-'+keys[2]),
            $track, areas;
          if (!$t.length || !(areas = $tdata.data('areas'))) { return; }
          $track = $t.parent();
          _.each(localAreaIds, function(dummy, id) {
            var area = areas[id],
              flags = {};
            if (target === "FLASHME") { flags.flashme = true; }
            else {
              flags.hover = true;
              if (target && target == tileId + '.' + id) { flags.tipTipActivated = true; }
            }
            $track.genotrack('makeAnchor', $t, area, $tdata.data('bppp'), $tdata.data('density'), flags);
          });
        });
        if (keys[3]=='hrefHash') {
          // Also highlight any existing .area's (e.g. labels on custom tracks)
          $elem.find('.browser-track-'+keys[0]+'>.bppp-'+classFriendly(keys[1])+'>.dens-'+keys[2]+'.href-hash-'+keys[4]).addClass('hover');
        }
      } else { throw 'something went wrong while running through the areaIndex'; }
      return (this._areaHover = keys[0] + '.' + keys[3] + '.' + keys[4]);
    },
    
    // Return the area index; other widgets can access it directly
    areaIndex: function() { return this._areaIndex; },
    
    // =====================================================
    // = Miscellaneous functions that didn't fit elsewhere =
    // =====================================================
    
    // Fetches DNA from the AJAX service for a particular bp range and sends it off to the callback function
    getDNA: function(left, right, callback, extraData) {
      var self = this,
        o = self.options,
        chunkSize = o.maxNtRequest;
      if (!this._dna) { this._dna = {}; }
      if (!this._dnaCallbacks) { this._dnaCallbacks = []; }
      
      function loadedFromAjax(data, statusCode, jqXHR) {
        self._dna[jqXHR._s] = data.seq;
        checkCallbacks();
      }
      function ajaxLoadDNA() {
        var slots = emptyCacheSlots(self.pos, self.pos + self.bpWidth() * self.$lines.length);
        _.each(slots, function(s) {
          $.ajax(o.ajaxDir + 'dna.php', {
            data: {db: o.genome, left: s * chunkSize + 1, right: (s + 1) * chunkSize + 1},
            dataType: 'json',
            success: loadedFromAjax,
            beforeSend: function(jqXHR) { jqXHR._s = s; }
          });
          self._dna[s] = false;
        });
      }
      function emptyCacheSlots(left, right) {
        // convert 1-based positions to 0-based
        left = Math.max(left - 1, 1);
        right = Math.min(right - 1, o.genomeSize);
        var i = Math.floor(left / chunkSize),
          end = Math.floor(right / chunkSize),
          slots = [];
        while (i <= end) { if (_.isUndefined(self._dna[i])) { slots.push(i); } i++; }
        return slots;
      }
      function getFromCache(left, right) {
        left--; right--; // convert 1-based positions to 0-based
        var i = Math.floor(left / chunkSize),
          end = Math.floor(right / chunkSize),
          segs = [], seg, start;
        while (i <= end) {
          seg = self._dna[i];
          start = Math.max(left - i * chunkSize, 0);
          if (!seg) { return null; }
          segs.push(seg.substr(start, i==end ? (right - end * chunkSize - start) : undefined));
          i++;
        }
        return segs.join('');
      }
      function checkCallbacks() {
        self._dnaCallbacks = _.filter(self._dnaCallbacks, function(c) {
          var dna = getFromCache(c.left, c.right);
          if (dna !== null) { c.fn(dna, c.extraData); return false; }
          else { return true; }
        });
      }
      
      var dna = getFromCache(left, right);
      if (dna !== null) { callback(dna, extraData); }
      else {
        this._dnaCallbacks.push({left: left, right: right, fn: callback, extraData: extraData});
        ajaxLoadDNA();
      }
    }
    
  });
  
  // ===================================================================
  // = Each line of the $.ui.genobrowser is managed by a $.ui.genoline =
  // ===================================================================
  
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
            self.$cont.css('text-indent', 1);
            self.$cont.animate({textIndent: 0}, {
              queue: false,
              duration: Math.abs(vInit / decel),
              step: function() {
                var newTime = (new Date).getTime(),
                  deltaT = newTime - now,
                  // allow the keyboard to shift the position *during* inertial scrolls
                  keyedOffset = o.browser.genobrowser('keyedOffset'),
                  deltaL = (vInit*deltaT) - (0.5*decel*deltaT*deltaT) + initKeyedOffset - keyedOffset;
                  left = xInit + deltaL;
                // for those looong inertial scrolls, keep the tiles coming
                if (Math.abs(deltaL - lastRefresh) > 1000) { lastRefresh = deltaL; self.fixTrackTiles(); }
                self.$cont.css('left', left);
                updatePos(left);
              },
              complete: function() { self.fixTrackTiles(); }
            });
          } else {
            self.fixTrackTiles();
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
      for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        if ($t.hasClass('browser-track-' + track.n)) { $t = $t.next(); }
        else { this._addTrack(track, $t); }
      }
      do { $u = $t; $t = $t.next(); $u.genotrack('side').remove(); $u.remove(); } while ($t.length);
      this.$side.sortable('refresh');
      this.fixFirstLabel(true);
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
    
    getPos: function() {
      return this.pos;
    },
    
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
        reticPos = this.centeredOn === null ? this.pos + 0.5 * (bpWidth - o.sideBarWidth * zoom) : this.centeredOn,
        chrStart, chrEnd, chrRetic;
      if (elem == o.browser.genobrowser('lines').get(0)) {
        chrStart = o.browser.genobrowser('chrAt', pos) || o.chrLabels[0];
        this.$indices.children('.start').text(chrStart.n + ':' + Math.floor(pos - chrStart.p));
      } else { this.$indices.children('.start').empty(); }
      if (elem == o.browser.genobrowser('lines').last().get(0)) {
        chrEnd = o.browser.genobrowser('chrAt', pos + bpWidth) || o.chrLabels[0];
        this.$indices.children('.end').text(chrEnd.n + ':' + Math.ceil(pos + bpWidth - chrEnd.p));
      } else { this.$indices.children('.end').empty(); }
      chrRetic = o.browser.genobrowser('chrAt', reticPos) || o.chrLabels[0];
      this.$retic.children('.n').text(chrRetic.n + ':' + Math.floor(reticPos - chrRetic.p));
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
    }
    
  });
  
  // ====================================================================
  // = Each track within a $.ui.genoline is managed by a $.ui.genotrack =
  // ====================================================================
  
  $.widget('ui.genotrack', {
    
    // Default options that can be overridden
    options: {
      disabled: false
    },
    
    // Called automatically when widget is instantiated
    _init: function() {
      var self = this,
        $elem = this.element, 
        o = this.options,
        bppps;
      self.ruler = o.track.n == 'ruler';
      self.sliderBppps = o.bppps.concat(o.overzoomBppps);
      self.tileLoadCounter = self.areaLoadCounter = 0;
      self.custom = !!o.track.custom;
      self.birth = (new Date).getTime();
      self.$side = $(o.side).append('<div class="subtrack-cont"/>');
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
    
    _initSideResizable: function() {
      var self = this,
        $elem = this.element,
        o = self.options,
        bF = self._bpppFormat(o.bppps[0]),
        firstFixedHeight = _.uniq(_.pluck(o.track.fh, _.flatten(o.track.s)[0])),
        paddingBordersY = self.$side.outerHeight() - self.$side.height(),
        minHeight = (self.custom ? o.track.custom.heights.min : Math.min(_.min(o.track.fh[bF]), 32)) - paddingBordersY,
        $linesBelow;
      var opts = {
        handles: 's', 
        minHeight: minHeight,
        start: function(e, ui) {
          var bppp = self.bppps().top,
            fixedHeights = o.track.fh[self._bpppFormat(bppp)];
          $('body').addClass('row-resizing');
          if (!self.ruler && !self.custom) {
            var $imgs = $('.browser-track-'+o.track.n+'>.bppp-'+classFriendly(bppp)+' img.tdata'),
              maxHeight = Math.max.apply(Math, $imgs.map(function() { 
                return this.naturalHeight || this.height; 
              }).get());
            $(this).resizable('option', 'maxHeight', Math.max(maxHeight * 1.2, ui.originalSize.height, 18));
          }
          if (!self.ruler) {
            self.snaps = fixedHeights && _.map(fixedHeights, function(v, k) { return k=='dense' ? v : v + 1; });
            if (self.snaps) { self.snaps.always = fixedHeights && !!(fixedHeights.pack || fixedHeights.full); }
          }
          o.browser.find('.browser-line').removeClass('last-resized');
          o.line.addClass('last-resized');
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
          o.browser.genobrowser('recvTrackResize', o.line, o.track.n, self.$side.outerHeight()); 
        }
      };
      if (self.ruler) { opts.maxHeight = o.track.h - paddingBordersY; }
      if (self.custom && o.track.custom.heights.max) { opts.maxHeight = o.track.custom.heights.max - paddingBordersY; }
      self.$side.resizable(opts);
    },
    
    side: function() { return this.$side; },
    
    _fixSide: function(density, bppp) {
      var self = this,
        o = self.options,
        n = o.track.n,
        $cont = self.$side.children('.subtrack-cont'),
        trackDesc = o.browser.genobrowser('option', 'trackDesc'), // always use the latest values from the browser
        densBpppMemo = [density, bppp].join('|'),
        dens, text, h;
      if ($cont.data('densBppp') === densBpppMemo) { return; }
      $cont.empty();
      if (dens = trackDesc[n] && trackDesc[n].dens && trackDesc[n].dens[density]) {
        if (dens[0][0] === 0) {
          // Labels change for certain bppp levels
          dens = (dens[_.sortedIndex(dens, [bppp], function(v) { return v[0]; }) - 1] || dens[0]).slice(1);
        }
        _.each(dens, function(v) {
          v = _.isArray(v) ? v : [v];
          h = v[1] || 15;
          $('<div class="subtrack"/>').css({height: h, lineHeight: h+'px'}).html(v[0]).appendTo($cont);
        });
      } else {
        text = (trackDesc[n] && trackDesc[n].sm) || o.track.n;
        h = o.track.h;
        $cont.append($('<div class="subtrack unsized"/>').text(text));
      }
      $cont.data('densBppp', densBpppMemo);
    },
    
    // public resize function that updates the entire UI accordingly.
    resize: function(height, animCallback) {
      var o = this.options,
        paddingBordersY = this.$side.outerHeight() - this.$side.height();
      // can pass callback==true to animate without a callback
      if (!_.isFunction(animCallback) && animCallback) { animCallback = function() {}; }
      this._resize(height, animCallback);
      if (animCallback) { this.$side.animate({height: height - paddingBordersY}, o.lineFixDuration); }
      else { this.$side.outerHeight(height); }
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
      if (_.isFunction(callback)) { 
        this.element.animate({height: height}, o.lineFixDuration, callback).css('overflow', 'visible'); 
      } else { this.element.height(height); }
    },
    
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
      self._fixSide(bestDensity, topBppp);
      $elem.find('.tile-full').children('.tdata,.area.label').each(function() {
        var $this = $(this),
          isBest = $this.hasClass('dens-'+bestDensity);
        $this.toggleClass('dens-best', isBest);
        if (isBest) { $this.trigger('bestDensity'); }
      });
      self.fixClipped();
    },
    
    _nearestBppps: function(zoom) {
      var o = this.options, 
        bppps = { nearest: [o.bppps[0]], cache: [], top:o.bppps[0] },
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
      if (this.ruler && zoom <= o.ideogramsAbove) {
        bppps.nearest = bppps.nearest.slice(-1);
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
      this._fixLabels(forceRepos);
      this._fixSideClipped();
    },
    
    _setImgDims: function(e) {
      // NOTE: this is only used as bound to a tile <img>'s onLoad! See _addTile
      var self = this,
        h = this.naturalHeight || this.height;
//      if (this.naturalHeight == 1) { _.defer(function() { console.log(self.naturalHeight); }) } // FIXME: this is sometimes erroneously 1px
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
        var $table = $('<table/>'),
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
            $('<td class="field" width="45%"/>').text(k).appendTo($tr);
            $('<td class="value" width="55%"/>').text(v).appendTo($tr);
          }
        });
        if (oldTitle) {
          $('<td colspan="2"/>').text(oldTitle).appendTo($('<tr class="name"/>').prependTo($tbody));
        }
        callback($table);
      }
      if (tiptipData) {
        createTipTipHtml(tiptipData);
      } else if (/^https?:\/\//.test(href)) {
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
          async: true, delay: 400,
          enter: this._areaTipTipEnter
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
    
    _areaDataFetch: function(e) {
      $.ajax(e.data.src + '.json', {
        dataType: 'json',
        success: e.data.success,
        beforeSend: e.data.beforeSend
      });
    },
    
    _areaDataLoad: function(data, statusText, jqXHR) {
      // NOTE: this is used as an AJAX callback, so this/self must be reobtained from the jqXHR object
      var o = jqXHR._self.options,
        $tile = $(jqXHR._appendTo),
        tileId = $tile.attr('id'),
        $tdata = $tile.children('.tdata.dens-'+jqXHR._density);
      
      function createAreas(e) {
        _.each($tdata.data('areas'), function(v, i) {
          // We have to make the label <a>'s for custom tracks
          if (jqXHR._custom && !v[6]) { jqXHR._self.makeAnchor($tile, v, jqXHR._bppp, jqXHR._density, {label: true, i: i}); }
        });
      };
      
      // Add to global area index: areaIndex[track][bppp][density]["hrefHash"|"name"][hrefHash|name][tileId][i] = true
      // FIXME: the global area index can get very big over time.
      _.each(data, function(v, i) {
        var index = jqXHR._areaIndex,
          keys = [o.track.n, jqXHR._bppp, jqXHR._density],
          indexBy = {hrefHash: shortHash(v[5]), name: v[4].toLowerCase()};
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
        $tdata.one('bestDensity', createAreas);
        if (jqXHR._density == jqXHR._bestDensity) { $tdata.trigger('bestDensity'); }
      }
      if (--jqXHR._self.areaLoadCounter === 0) { $(jqXHR._self.element).trigger('areaload', jqXHR._bestDensity); };
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
      var o = this.options;
      $tile.css('left', (tileId - o.line.genoline('option', 'origin')) / zoom);
      $tile.css('width', Math.ceil(o.tileWidth * bppp / zoom));
      
      if (this.ruler && bppp <= o.ntsBelow[0]) {
        $tile.find('svg').each(function() {
          var width = $tile.width() + 'px';
          this.setAttributeNS(null, "width", width);
          this.firstChild.setAttributeNS(null, "y", "11");
        });
      }
    },
    
    _specialTile: function(tileId, bppp) {
      var o = this.options;
      if (tileId < 0 || tileId > o.genomeSize) { return {blank: true, left: tileId < 0}; }
      if (o.track.custom) { return {custom: true}; }
      if (this.ruler && bppp <= o.ideogramsAbove) { return {ruler: true}; }
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
    
    _fixLabels: function(forceRepos) {
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
      
      if (o.chrBands && zoom <= o.ideogramsAbove) {
        var firstBandIndex = _.sortedIndex(o.chrBands, [0, 0, leftMarg], function(v) { return v[2]; }),
          lastBandIndex = _.sortedIndex(o.chrBands, [0, rightMarg], function(v) { return v[1]; }),
          bandsNeeded = o.chrBands.slice(firstBandIndex, lastBandIndex),
          bandElements = [];
        _.each(bandsNeeded, function(v) {
          var repos = false, $b = $('#' + self._tileId(v[1], 'band'));
          if (!$b.length) { $b = self._addBand(v, zoom); repos = true; }
          if (repos || forceRepos) { self._reposBand($b, v, zoom); }
          bandElements.push($b.get(0));
        });
        $elem.children('.band').not(bandElements).remove();
      } else {
        $elem.children('.band').remove();
      }
    },
    
    _rulerTile: function($t, tileId, bppp) {
      var self = this,
        o = self.options,
        bpPerTile = bppp * o.tileWidth,
        zoom = o.browser.genobrowser('zoom');
      $t.addClass('tile-ruler bppp-'+classFriendly(bppp)).data('bppp', bppp);
      
      self._drawCanvasTicks($t, tileId, bppp, zoom);
      
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
    
    _drawCanvasTicks: function($t, tileId, bppp, zoom) {
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
        $t.toggleClass('tile-halfway', bppp == o.bpppNumbersBelow[0]);
        $t.toggleClass('tile-loaded', bppp <= o.bpppNumbersBelow[1]);
        if (o.useCanvasTicks) {
          // This may alleviate some of the excessive element creation that occurs with the HTML method
          start -= step;
          var offsetForNtText = !o.chrBands && bppp <= o.ntsBelow[1],
            canvasHeight = o.chrBands ? 23 : (offsetForNtText ? 12 : 23),
            canvasWidth = bppp / zoom * o.tileWidth,
            $oldC = $t.children('canvas.ticks'),
            canvasAttrs = {width: canvasWidth, height: canvasHeight, "class": "ticks" + ($oldC.length ? ' hidden' : '')},
            $c = $.mk('canvas').css('height', canvasHeight).prependTo($t),
            ctx = $c.get(0).getContext && $c.get(0).getContext('2d'),
            textY = o.chrBands ? 16 : (offsetForNtText ? 10 : 16),
            defaultFont = "11px 'Lucida Grande',Tahoma,Arial,Liberation Sans,FreeSans,sans-serif";
          if ($.browser.opera) { defaultFont = "12px Arial,sans-serif"; } // Opera can only render Arial decently on canvas
          if (!ctx) { return; }
          $c.attr(canvasAttrs);
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
          if ($oldC.length) { 
            $oldC.addClass('hidden');
            $c.removeClass('hidden');
            setTimeout(function() { $oldC.remove(); }, 1000);
          }
        } else {
          function ghostify(text) {
            text = text.toString();
            return text;
            if (!text.length) { return ''; }
            return '<span class="ghost-' + text.split('').join('"></span><span class="ghost-') + '"></span>';
          }
          
          for (var t = start; t + chr.p < tileId + bppp * o.tileWidth; t += step) {
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
              tickHTML = '<div class="tick' + (isMajor ? ' major">' + ghostify(major ? major : '') : '">') + 
                '<span class="minor">' + ghostify(minor + (isMajor ? unit[1] : '')) + '</span></div>',
              $tick = $(tickHTML).appendTo($t);
            $tick.css('right', ((1 - (t + chr.p - tileId + 0.5) / bpPerTile) * 100)+'%'); // The 0.5 centers it over the base.
          }
        }
      }
    },
    
    redrawCanvasTicks: function() {
      var self = this,
        $elem = self.element, 
        o = self.options,
        zoom = o.browser.genobrowser('zoom');
      $elem.children('.tile-ruler').each(function() {
        var $t = $(this);
        self._drawCanvasTicks($t, $t.data('tileId'), $t.data('bppp'), zoom);
      });
    },
    
    _ntSequenceLoad: function(dna, extraData) {
      if (!dna) { return; }
      var o = extraData._self.options,
        $d = extraData._d,
        l = dna.length,
        ppbp = o.tileWidth / l, // pixels per bp
        colors = {a:'255,0,0', t:'255,0,255', c:'0,0,255', g:'0,180,0'},
        canvas, height, ctx, nt;
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
      height = canvas.height;
      ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) { return; }
      for (var i = 0; i < l; i++) {
        nt = dna.substr(i, 1);
        if (nt == '-') { continue; }
        ctx.fillStyle = "rgb(" + colors[nt.toLowerCase()] + ")";
        ctx.fillRect(i * ppbp, 0, ppbp, height);
      }
    },
    
    _addLabel: function(label, zoom) {
      var o = this.options,
        $l = $.mk('div').text(label.n.replace(/^chr/,'')).addClass('label label-'+label.p);
      if (label.n.indexOf('chr') === 0) { $l.prepend('<span class="chr">chr</span'); }
      if (!o.chrBands) { $l.prepend('<span class="start-line"></span>'); }
      return $l.appendTo(this.element);
    },
    
    _reposLabel: function($l, label, zoom) {  
      $l.css('left', (label.p + 1 - this.options.line.genoline('option', 'origin')) / zoom);
    },
    
    _addBand: function(band, zoom) {
      var o = this.options,
        $b = $('<div class="band band-'+band[4]+' band-'+band[3].substr(0,1)+'"/>');
      $b.attr('id', this._tileId(band[1], 'band'));
      if (band[5] === 0) { $b.prepend('<div class="chr-start"/>'); }
      $b.append($('<div class="band-name"/>').text(band[0].substr(3) + band[3]));
      return $b.appendTo(this.element);
    },
    
    _reposBand: function($b, band, zoom) { 
      var o = this.options, 
        prop = band[4] == 'acen' ? (/^p/.test(band[3]) ? 'border-left-width' : 'border-right-width'): 'width';
      $b.css('left', (band[1] - o.line.genoline('option', 'origin')) / zoom);
      $b.css(prop, (band[2] - band[1]) / zoom + 1); 
    },
    
    _customTileRender: function(e, callback) {
      var canvas = this,
        $canvas = $(this),
        d = e.data;
      function pushCallback() { _.isFunction(callback) && $canvas.data('renderingCallbacks').push(callback); }
      if ($canvas.data('rendering') === true) { pushCallback(); return; }
      $canvas.data('rendering', true);
      $canvas.data('renderingCallbacks', []);
      pushCallback();
      d.custom.render(this, d.start, d.end, d.density, function() {
        $canvas.css('width', '100%').css('height', d.custom.stretchHeight ? '100%' : canvas.height);
        $canvas.toggleClass('stretch-height', d.custom.stretchHeight);
        $canvas.removeClass('unrendered').addClass('no-areas');
        e.data.self.fixClickAreas();
        _.each($canvas.data('renderingCallbacks'), function(f) { f(); });
      });
    },
    
    _customTile: function($t, tileId, bppp, bestDensity) {
      var self = this,
        o = self.options,
        bpPerTile = bppp * o.tileWidth,
        end = tileId + bpPerTile;
      $t.addClass('tile-custom tile-full tile-loaded bppp-'+classFriendly(bppp));
      _.each(o.track.s, function(density) {
        var canvasHTML = '<canvas width="'+o.tileWidth+'" height="'+o.track.h+'" class="tdata unrendered dens-'+density+'" '
            + 'id="canvas-'+self._tileId(tileId, bppp)+'-'+density+'"></canvas>',
          $c = $(canvasHTML).appendTo($t);
        $c.bind('render', {start: tileId, end: end, density: density, self: self, custom: o.track.custom}, self._customTileRender);
        if (density==bestDensity) { $c.addClass('dens-best').trigger('render'); }
      });
    }
    
  });

})(jQuery);
