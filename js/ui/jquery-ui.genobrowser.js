/*jshint node: true */

module.exports = function($, _) {

  require('./jquery.misc-plugins.js')($, _);
  require('./jquery.tiptip.js')($, _);
  require('./jquery.farbtastic.js')($);

  // Sum elements of an array
  _.sum = function(arr) { return _.reduce(arr, function(memo, next) { return memo + next; }, 0); };

  var utils = require('./utils.js')($),
    classFriendly = utils.classFriendly,
    basename = utils.basename,
    floorHack = utils.floorHack,
    decodeSafeOctets = utils.decodeSafeOctets,
    regExpQuote = utils.regExpQuote;

  /****************************************************************************************/
  //
  // We have three widgets that are built on the jQuery UI $.widget framework
  //    1) $.ui.genobrowser
  //    2) $.ui.genoline
  //    3) $.ui.genotrack
  //
  /****************************************************************************************/

  require('./jquery-ui.genoline.js')($, _);
  require('./jquery-ui.genotrack.js')($, _);

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
      availTracks: [],
      compositeTracks: [],
      groupTracksByCategories: false, // affects the track picker, set to EITHER true OR an array to set the order
      searchableTracks: false,  // can set to a URL to allow even more tracks to be added via AJAX
      chrOrder: [],
      chrLengths: {},
      chrBands: [],
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
      genomePicker: ['#genome', '#genome-picker', '#change-genome'],
      lineMode: '#line-mode',
      linking: ['#linking', '#link-picker'],
      warnings: ['#warnings'],
      overlay: ['#overlay', '#overlay-message'],
      lineFixDuration: 500,
      reticOpacity: 0.8,
      verticalDragDeadZone: 12,
      maxNtRequest: 50000,
      bounceMargin: 0.2,
      dialogs: ['#custom-dialog', '#quickstart', '#about', '#old-msie', '#genomes-dialog',
                ['#search-dbs-tab', '#open-file-url-tab'], '#binaries-warning-dialog', '#warnings-dialog'],
      ucscURL: 'http://genome.ucsc.edu/cgi-bin/hgTracks',
      trackDescURL: 'http://genome.ucsc.edu/cgi-bin/hgTrackUi',
      bpppFormat: function(bppp) { return bppp.toExponential(2).replace(/(\+|-)(\d)$/, '$10$2'); },
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
        tracksToParse;

      // Some user agents need some minor style tweaking
      $.browser.actuallySafari = $.browser.safari && navigator && !(/chrome/i).test(navigator.userAgent);

      // Setup internal variables
      self._initInstanceVars();

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
          $(o.navBar).toggleClass('narrow', self._width < 950).find('.picker').trigger('remaxheight');
        }
      });
      $(document.body).bind('wheel', _.bind(self._recvZoom, self));
      $(o.zoomBtns[0]).button().click(function() { delete self.centeredOn; self._animateZoom(true, 1000); });
      $(o.zoomBtns[1]).button().click(function() { delete self.centeredOn; self._animateZoom(false, 1000); });
      $elem.mouseenter(function() { self.showReticle('mouseArea', false); });
      $elem.mouseleave(function() { self.showReticle('mouseArea', true); });
      $(o.lineMode).buttonset().click(function() { self._fixNumLines(self.centralLine); });
      $(o.lineMode).find('input,a').focus(function() { var $t = $(this); _.defer(function() { $t.blur(); }); });
      $elem.bind('trackload', _.bind(self._recvTrackLoad, self));
      $(window).bind('popstate', function() { self._initFromParams(null, true); });

      // Initialize the footer, the search bar, hotkeys, the AJAX proxy, mobile interactions, IE fixes
      self._initFooter();
      self._initJump();
      self._initHotkeys();
      self._initAjax();
      self._initMobileFeatures();
      if ($.browser.msie) { self._initIEFixes(); }
      
      // Finally, parse any custom track data provided with the initial genome, and then apply params from either 
      //     the URL or the session state (to set visible tracks, zoom, position, etc.)
      tracksToParse = _.filter(o.availTracks, function(t) { return !!t.customData; });
      self._parseCustomGenomeTracks(tracksToParse, function() {
        _.each(o.tracks, function(t) { $.extend(t, self.availTracks[t.n]); });
        $(window).trigger('resize', function() { self._initFromParams(null, true); });
      });
    },

    // Called when a new options object is passed in, typically after a custom genome is loaded
    _setOptions: function(options) {
      var self = this,
        $elem = self.element,
        o = self.options,
        tracksToParse,
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        nextDirectives = _.extend({}, self._nextDirectives),
        nextDirectivesPosition = nextDirectives.position && self.normalizePos(nextDirectives.position, true);
      self._resetCustomTracks();
      self._removeLines(self.$lines.length, {duration: 0});

      o = _.extend(self.options, options);

      self._initInstanceVars();
      // Disable tile fixing until after custom genome tracks are parsed and the nextDirectives are followed
      self.tileFixingEnabled(false);

      tracksToParse = _.filter(o.availTracks, function(t) { return !!t.customData; });

      function finishSetup() {
        _.each(o.tracks, function(t) {
          $.extend(t, self.availTracks[t.n]);
        });

        self.$slider = self._initSlider();
        self.$trackPicker = self._initTrackPicker();
        self._updateGenomePicker();

        $overlay.add($overlayMessage).hide();
        $(window).trigger('resize', function() {
          self._nextDirectives = {};
          if (_.keys(nextDirectives).length) { self._initFromParams(nextDirectives); }
          self.tileFixingEnabled(true);
        });
      }

      self._parseCustomGenomeTracks(tracksToParse, finishSetup, nextDirectivesPosition);
    },

    _initInstanceVars: function() {
      var self = this,
        $elem = self.element,
        o = self.options,
        p = 0;

      // Setup internal variables related to chromosome bands, lengths, and available tracks
      self.chrPos = {};  // 0-based positions of each chromosome (or contig) in genomic coordinates
      o.chrLabels = [];
      _.each(o.chrOrder, function(v, i){
        o.chrLabels.push({p: p, n: v, w: o.chrLengths[v]}); self.chrPos[v] = p; p += o.chrLengths[v];
      });
      o.chrLabels.push({p: p, n: '', end: true}); // one more label for the end of the last chromosome
      _.each(o.chrBands, function(v){ v[5] = v[1]; v[1] += self.chrPos[v[0]]; v[2] += self.chrPos[v[0]]; });
      o.chrBands = o.chrBands && _.sortBy(o.chrBands, function(v) { return _.indexOf(o.chrOrder, v[0]) * o.genomeSize + v[1]; });
      self.availTracks = {};
      self.compositeTracks = {};
      self.defaultTracks = [];
      _.each(o.availTracks, function(v) { self.availTracks[v.n] = $.extend({}, v, {oh: v.h}); });
      _.each(o.compositeTracks, function(v) { self.compositeTracks[v.n] = v; });
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
      self._dna = {};
      self._searchId = 0;
    },

    _initSlider: function() {
      var self = this,
        o = this.options;
      if (!o.overzoomBppps) { o.overzoomBppps = []; }

      var $slider = $(o.zoomSlider),
        numBppps = o.bppps.length + o.overzoomBppps.length,
        sliderWidth = (numBppps - 1) * 10,
        sliderBppps = (self.sliderBppps = o.bppps.concat(o.overzoomBppps)),
        prevVals = [],
        $ticks;

      function start(e, ui) { delete self.centeredOn; }
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
      }
      function stop(e, ui) {
        if (e.originalEvent && e.originalEvent.type=="keyup") { return; }
        var direction = prevVals[0] < ui.value;
        o.snapZoomAfter && _.defer(function() { self._animateZoom(direction); });
      }

      $slider.parent().children('.ticks').remove();
      $ticks = $('<div class="ticks"/>').appendTo($slider.parent());
      $ticks.html(new Array(numBppps + 1).join('<div class="tick"/>'));

      if ($slider.hasClass('ui-slider')) { $slider.slider('destroy'); }
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
    // Safe to call multiple times.
    _createPicker: function($btn, $picker, $done) {
      var self = this,
        $elem = $(self.element),
        closePicker = function() { $picker.slideUp(100); };
      $picker.unbind('remaxheight.genobrowser').bind('remaxheight.genobrowser', function() {
        var $notUl = $(this).children().not('ul'),
          $ul = $(this).children('ul').eq(0),
          visible = $(this).is(':visible'),
          formLineHeights;
        if (!visible) { $(this).show(); } // can't make measurements while hidden
        formLineHeights = _.map($notUl, function(el) {
          return Math.max($(el).outerHeight(), $(el).find('textarea').outerHeight());
        });
        $ul.css('max-height', $elem.outerHeight() - _.sum(formLineHeights));
        if (!visible) { $(this).hide(); }
      });
      $btn.unbind('click.genobrowser').bind('click.genobrowser', function() {
        if (!$picker.is(':visible')) {
          $('body').bind('mousedown.picker', function(e) {
            if ($(e.target).closest($picker.add($btn)).length) { return; }
            closePicker();
            $('body').unbind('mousedown.picker');
          });
          if ($btn.is('a.ui-button')) { $btn.addClass('ui-state-active'); }
          _.defer(function() { $picker.find('[type=search]').focus().select(); });
          $picker.trigger('remaxheight');
        }
        $picker.slideToggle(100);
      });
      if ($done) { $done.unbind('click.genobrowser').bind('click.genobrowser', closePicker); }
      return $picker.unbind('close.genobrowser').bind('close.genobrowser', closePicker);
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
        $toggleBtn = $(o.genomePicker[2]).button(),
        speciesParenthetical = o.species.match(/\((.+)\)/),
        $binaryWarningDialog = $(o.dialogs[6]),
        $a;

      $ul.append('<li class="divider"/>');
      $a = $('<a class="clickable"/>').attr('href', o.dialogs[5][0]).appendTo($('<li class="choice"/>').appendTo($ul));
      $('<span class="name"/>').text('Load more genomes\u2026').appendTo($a);
      $('<span class="long-desc"/>').text('from UCSC, GenBank and IGB').appendTo($a);
      $ul.append('<li class="divider"/>');
      $a = $('<a class="clickable"/>').attr('href', o.dialogs[5][1]).appendTo($('<li class="choice"/>').appendTo($ul));
      $('<span class="name"/>').text('Open file or URL\u2026').appendTo($a);
      $('<span class="long-desc"/>').text('in GenBank or FASTA format').appendTo($a);

      $genome.find('.clickable').hover(function() { $(this).addClass('hover'); }, 
                                       function() { $(this).removeClass('hover'); });
      self._updateGenomePicker();

      self._createPicker($toggleBtn, $genomePicker);

      // Setup the dialogs that appear upon clicking footerbar links
      _.each(_.flatten(o.dialogs), function(id) {
        var $dialog = $(id).closest('.ui-dialog');
        function openDialog() {
          $('.ui-dialog').hide();
          $dialog.addClass('visible').show();
          $dialog.find('a[href^="http://"],a[href^="https://"]').attr('target', '_blank');
          $dialog.css('top', Math.max(($elem.parent().innerHeight() - $dialog.outerHeight()) * 0.5, 30));
        }
        $dialog.bind('open.genobrowser', openDialog);
        $foot.find('a[href='+id+']').click(function() { 
          $dialog.trigger('open.genobrowser');
          if ($(id).hasClass('ui-tabs-panel')) { $dialog.find('.ui-tabs-nav a[href="'+id+'"]').click(); }
        });
        $dialog.find('.ui-dialog-buttonpane button').button().not('.dont-close').click(function() {
          $dialog.fadeOut();
        });
      });

      self._initCustomGenomeDialog();

      // Show the quickstart screen if the user has never been here before and the viewport is big enough to show it
      if ($.cookie('db')===null && $(window).width() > 600 && $(window).height() > 420) {
        $foot.find('a[href="'+o.dialogs[1]+'"]').click();
      }
      // Show the uninstalled binaries warning, if it was written into the page
      if ($binaryWarningDialog.length) { $binaryWarningDialog.trigger('open.genobrowser'); }
    },

    _initTrackPicker: function() {
      var self = this,
        o = self.options,
        d = o.trackDesc,
        allTracks = self._sortedTracks(o.availTracks.concat(o.compositeTracks)),
        groups = {},
        ungrouped = {},
        $toggleBtn = $(o.trackPicker[0]).button(),
        $trackPicker = $(o.trackPicker[1]).empty(),
        $searchBar = $('<div class="search-bar"/>').appendTo($trackPicker),
        $ul = $('<ul class="choices"/>').appendTo($trackPicker),
        $div = $('<div class="button-line"/>').appendTo($trackPicker),
        $reset = $('<a>reset</a>').button().appendTo($div),
        $b = $('<a>done</a>').button().appendTo($div),
        $search, searchDebounced;

      function addSection(cat) {
        var $li = $('<li class="category-section"/>').appendTo($ul),
          $header = $('<div class="category-header"/>').text(cat).appendTo($li);
        $('<div class="collapsible-btn"><div class="arrow"/></div>').prependTo($header);
        $header.click(_.bind(self._trackPickerClicked, self));
        return $('<ul/>').appendTo($li);
      }
      
      if (o.groupTracksByCategories) {
        var groupNames;
        _.each(allTracks, function(t) {
          var n = t.n,
            cat = d[n].cat;
          if (t.parent) { return; }
          if (!cat) { ungrouped[n] = t; return; }
          groups[cat] = groups[cat] || {};
          groups[cat][n] = t;
        });
        groupNames = _.keys(groups);
        if (_.isArray(o.groupTracksByCategories)) {
          groupNames = _.sortBy(groupNames, function(cat) { 
            var catIndex = _.indexOf(o.groupTracksByCategories, cat);
            return catIndex === -1 ? Infinity: catIndex; 
          });
        }
        self._addTracks(ungrouped, null, 100);
        _.each(groupNames, function(cat) {
          self._addTracks(groups[cat], addSection(cat), 100);
        });
      } else { self._addTracks(allTracks); }

      if (o.searchableTracks) {
        $search = $('<input type="search"/>').appendTo($searchBar);
        searchDebounced = _.debounce(function() { self._searchTracks($search.val()); }, 200);
        $search.bind('keyup search', function(e) {
          var typeMore = $search.val().length > 0 && $search.val().length < 3,
            typeMoreToLoadMoreTracks = o.custom && o.custom.canSearchTracks && typeMore;
          $searchBar.toggleClass('type-more', typeMoreToLoadMoreTracks);
          searchDebounced();
        });
        $search.attr('placeholder', o.searchableTracks === true ? 'Filter available tracks...'
            : 'Find more tracks for this genome...');
        $('<li class="search-warn"/>').hide().appendTo($ul);
        if (!$.browser.actuallySafari) {
          $search.addClass('search');
          $('<span class="search-icon"/>').appendTo($searchBar);
        }
      } else { $searchBar.hide(); }

      if (o.tracks.length === 1) { $ul.find('input[name='+o.tracks[0].n+']').attr('disabled', true); }
      $reset.click(function(e) { self._resetToDefaultTracks(); });
      return self._createPicker($toggleBtn, $trackPicker, $b).hide();
    },

    _initCustomTracks: function() {
      var self = this,
        $elem = self.element,
        o = self.options,
        fileInputHTML = '<input type="file" name="customFile"/>',
        $toggleBtn = $(o.trackPicker[2]).button(),
        $picker = $(o.trackPicker[3]).hide(),
        $ul = $('<ul class="choices"/>').prependTo($picker),
        $add = $picker.find('.form-line').first(),
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        $urlInput, $urlGet, $div, $b, $reset;

      function browserOpts(context) {
        var nextDirectives = _.extend({}, self._nextDirectives),
          pos = nextDirectives.position && self.normalizePos(nextDirectives.position, true);
        pos = pos ? pos.pos : self.pos;
        return {
          bppps: o.bppps,
          chrPos: self.chrPos,
          genome: o.genome,
          pos: pos,
          chrLengths: o.chrLengths,
          genomeSize: o.genomeSize,
          ajaxDir: o.ajaxDir,
          context: context
        };
      }

      self._customTrackUrls = {
        requested: [],
        processing: [],
        loaded: []
      };

      self._initWarningsDialog();
      function customTrackError(err) {
        $picker.find('.spinner').hide();
        err.message && self.showWarning(err.message.replace(/^Uncaught \w+: /, ''), err);
        replaceFileInput();
      }

      function closePicker() { $picker.slideUp(100); }

      function handleFileSelect(e) {
        var formatchecker = new FileReader(),
          reader = new FileReader(),
          $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner').show();
        if (e.target.files.length) {
          formatchecker.onload = (function(f) {
            return function(ev) {
              var info = CustomTracks.guessFormat(ev.target.result);
              if (info.binary) {
                format = info.format ? (", " + info.format + ",") : "";
                customTrackError({message: "Looks like you tried to load a binary format" + format + " from disk. " +
                    "Binary files must be loaded from a URL.", context: f.name});
                return;
              }
              reader.onload = function(eve) {
                CustomTracks.parseAsync(eve.target.result, browserOpts(f.name), function(tracks) {
                  $spinner.hide();
                  self._addCustomTracks(f.name, tracks);
                });
              };
              reader.readAsText(f);
            };
          })(e.target.files[0]);
          formatchecker.readAsArrayBuffer(e.target.files[0].slice(0, 128))
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
      
      function parsePastedData(pastedData, $spinner) {
        CustomTracks.parseAsync(pastedData, browserOpts("pasted data"), function(tracks) {
          $spinner.hide();
          self._addCustomTracks(_.uniqueId('pasted_data_'), tracks);
          $add.find('textarea').val('');
        });
      }
      function loadPastedUrls(pastedUrls, $spinner) {
        var urls = _.compact(_.map(pastedUrls.split("\n"), function(line) { return $.trim(line); })),
          numUrls = urls.length;
        
        var updateProgress = (function() {
          var progress = _.map(_.range(numUrls), function() { return 0; });
          return function (which, loaded, total) {
            var $progress = $overlayMessage.find('.ui-progressbar');
            if (!$progress.length) { $progress = $('<div/>').appendTo($overlayMessage).progressbar(); }
            progress[which] = loaded/total * 100 / numUrls;
            $progress.progressbar('value', _.reduce(progress, function(memo, n) { return memo + n; }, 0));
          }
        })();
        
        var hideOverlay = _.after(numUrls, function() { 
          $spinner.hide();
          $overlay.add($overlayMessage).fadeOut();
        });
        
        _.each(urls, function(url, i) {
          self._customTrackUrls.requested = _.without(self._customTrackUrls.requested, url);
          self._customTrackUrls.processing = _.union(self._customTrackUrls.processing, [url]);
          $.ajax(url, {
            success: function(data) {
              CustomTracks.parseAsync(data, browserOpts(url), function(tracks) {
                self._customTrackUrls.loaded = _.union(self._customTrackUrls.loaded, [url]);
                self._addCustomTracks(basename(url), tracks, url);
                hideOverlay();
              });
            },
            progress: _.partial(updateProgress, i),
            error: function() {
              hideOverlay();
              customTrackError({message: "No valid custom track data was found at this URL.", context: url});
            }
          });
        });
      }
      function handlePastedData(e) {
        var $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner').show(),
          $textarea = $add.find('textarea'),
          pastedData = $.trim($textarea.val());
        if ((/^https?:\/\//).test(pastedData)) { loadPastedUrls(pastedData, $spinner); }
        else { parsePastedData(pastedData, $spinner); }
        $textarea.val('');
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

      // Redefine the CustomTracks error handler so the user can see parse errors for their custom track(s).
      CustomTracks.error = customTrackError;

      $div = $('<div class="button-line"/>').appendTo($picker);
      $reset = $('<a>reset</a>').button().appendTo($div);
      $b = $('<a>done</a>').button().appendTo($div);
      $reset.click(function(e) { self._resetCustomTracks(); });

      return self._createPicker($toggleBtn, $picker, $b);
    },

    _initLinking: function() {
      var self = this,
        o = self.options,
        $linkBtn = $(o.linking[0]),
        $linkPicker = $(o.linking[1]),
        $url = $linkPicker.find('.url'),
        $copyBtn = $linkPicker.find('.copy-btn');
      $linkBtn.button().click(function(e) { _.defer(function () { $url.select().focus(); }); return false; });
      $copyBtn.button().click(function(e) { _.defer(function() { $linkBtn.click(); document.execCommand("copy"); }) });
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
      $jump.button().click(jumpToSubmit);
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
        var now = (new Date()).getTime(),
          deltaY = motionOpts.dir * x(now - motionOpts.start) - motionOpts.prev;
        self._keyedOffset -= deltaY;
        self._pos(self.pos - deltaY * self.bppp);
        motionOpts.prev += deltaY;
      }
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
        } else {
          self._keyedOffset += dir * self.lineWidth();
          self._pos(self.pos + dir * self.bpWidth());
          self.bounceCheck();
        }
      });
      $(document).bind('keydown', 'left a right d', function(e) {
        var dir = e.which == 37 || e.which == 65 ? 1 : -1, // left=>37, a=>65
          now = (new Date()).getTime();
        if (motionOpts.dir == dir) { return; }
        clearInterval(motionInterval);
        motionOpts = {dir: dir, start: now, prev: 0};
        motionInterval = setInterval(motion, 13); // based off of jQuery's .animate interval
      });
      $(document).bind('keyup', 'left a right d', function(e) {
        var dir = e.which == 37 || e.which == 65 ? 1 : -1;
        if (motionOpts.dir == dir) { clearInterval(motionInterval); self.bounceCheck(); motionOpts.dir = 0; }
      });
      $(document).bind('keydown', shiftEverything, function(e) {
        delete self.centeredOn;
        self._animateZoom(_.include([38, 87, 39, 68], e.which), 1000); // up=>38, w=>87, right=>39, d=>68
      });
      $(document).bind('keydown', 'esc', function(e) {
        var $pickers = $(o.trackPicker[1] + ',' + o.trackPicker[3]);
        $pickers.each(function() { $(this).is(':visible') && $(this).find('input[name=done]').click(); });
      });
    },

    _initAjax: function() {
      var options = this.options;
      // proxy external URLs through our local AJAX proxy
      $.ajax = (function(_ajax){
        var protocol = location.protocol,
          hostname = location.hostname,
          exRegex = new RegExp(protocol + '//' + hostname),
          proxyURL = options.ajaxDir + 'proxy.php';

        function isExternal(url) {
          return !exRegex.test(url) && (/:\/\//).test(url);
        }

        return function(url, o) {
          if ( typeof url === "object" ) {
            o = url;
            url = o.url;
          } else { o.url = url; }

          // capture and forward progress events from XHR's to o.progress callback
          o.xhr = (function(_xhr){
            return function() {
              var xhr = _.isFunction(_xhr) ? _xhr() : new window.XMLHttpRequest();
              xhr.addEventListener("progress", function(e) {
                var total = e.lengthComputable ? e.total : xhr.getResponseHeader('X-Content-Length');
                if (total && _.isFunction(o.progress)) {
                  o.progress.call(this, e.loaded, total);
                }
              }, false);
              return xhr;
            };
          })(o.xhr);

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

      $(window).bind('orientationchange', function() { $(window).resize(); });

      if (!$.support.touch) { return; }
      $elems.addClass('mobile');

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
          var delta = (pinchWidth / prevPinchWidth - 1) * 100,
            // TODO: delta could probably be tweaked to proviude perfect positional zooming
            fakeEvent = {target: touchTarget, originalEvent: {srcElement: touchTarget, pageX: center}};
          // Simulate the equivalent mousewheel event
          self._recvZoom(fakeEvent, delta);
        }
        prevPinchWidth = pinchWidth;
      });
      $(document).bind('touchend', function(e) { cachedPageXs = {}; prevPinchWidth = touchTarget = center = null; });

      $(o.lineMode).find('input[value=single]').attr('checked', true);
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

    _initCustomTrackDialog: function(genomeSuppliedTrack) {
      var self = this,
        o = self.options,
        $dialog = $(o.dialogs[0]).closest('.ui-dialog');

      $dialog.data('genobrowser', self.element);
      $dialog.find('.hidden').hide();
      $dialog.find('.show').show();
      if (genomeSuppliedTrack) { $dialog.find('.delete').hide(); }

      if ($dialog.hasClass('initialized')) { return; } // The following only needs to be initialized once

      $dialog.bind('open.genobrowser', function() { 
        self.$customTracks.trigger('close.genobrowser');
        self.$trackPicker.trigger('close.genobrowser');
      });
      $dialog.find('.range-slider').each(function() {
        var $min = $(this).prev('input'),
          $max = $(this).next('input'),
          min = parseFloat($min.val()),
          max = parseFloat($max.val()),
          $slider = $(this);
        $slider.slider({
          range: true,
          min: min,
          max: max,
          values: [min, max],
          slide: function(event, ui) {
            $min.val(ui.values[0]);
            $max.val(ui.values[1]);
          }
        });
        $min.change(function() { $slider.slider('value', $(this).val()); });
        $max.change(function() { $slider.slider('values', [$slider.slider('values')[0], $(this).val()]); });
      });
      $dialog.find('.color').each(function() {
        var $input = $(this),
          $p = $('<div class="color-picker ui-widget-content ui-corner-bottom shadow"></div>').insertAfter($input);
        $p.farbtastic(this);
        $input.focus(function() { $p.show(200); });
        $input.blur(function() { $p.hide(200); });
        $p.hide();
        $('<input type="button" value="done">').appendTo($p).click(function() { $input.blur(); });
      });
      $dialog.find('.enabler').each(function() {
        var $input = $(this);
        $input.change(function() {
          var value = $input.is(':checked');
          $input.siblings('[type=text]').attr('disabled', !value).toggleClass('disabled', !value);
          $input.siblings('.range-slider').slider(value ? 'enable' : 'disable');
        });
      });
      $dialog.find('[name=save]').click(function() {
        var trk = $dialog.data('track');
        trk.custom.saveOpts($dialog);
        self.$lines.find('.browser-track-'+trk.n+' .tile-custom canvas').trigger('erase').trigger('render');
        $dialog.data('track', false);
      });
      $dialog.find('[name=delete]').click(function() {
        $(this).hide();
        $dialog.find('.delete-confirm').fadeIn();
      });
      $dialog.find('[name=really_delete]').click(function() {
        var tname = $dialog.data('track').n;
        self._removeCustomTrack(tname);
        $dialog.data('track', false);
      });
      $dialog.addClass('initialized');
    },

    _initCustomGenomeFromDatabase: function(handlePastedData, updateSaveBtnState) {
      var self = this,
        o = self.options,
        $genomeDialog = $(o.dialogs[4]).closest('.ui-dialog'),
        $chromSizesTabs = $genomeDialog.find('.tabs'),
        $genomeList = $genomeDialog.find('.genome-list'),
        $addIgbSource = $genomeDialog.find('.add-choice'),
        $filterGenomes = $genomeDialog.find('[name=filterGenomes]'),
        _lastGenBankSearch = null;

      // Cache all IGB Quickload directory data, by URL
      self._igbQuickloadData = self._igbQuickloadData || {};

      function hoverClasses($clickables) {
        return $clickables.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
      }

      function makeGenomeListLi(kind, db, name, longDesc, source) {
        var $li = hoverClasses($('<li class="choice clickable ' + kind.toLowerCase() + '"/>')),
          $h3 = $('<h3 class="name"/>').text(name).appendTo($li),
          $p = $('<p class="long-desc"/>').text(longDesc).appendTo($li);
        $h3.append('<span class="source-tag">'+kind+'</span>');
        return $li.data('db', db).data('source', source || kind.toLowerCase());
      }
      
      function makeGenomeSourceLi(url, checked) {
        var $li = $('<li class="choice"/>'),
          $label = hoverClasses($('<label class="clickable"/>')).appendTo($li),
          $chk = $('<input type="checkbox" name="source"/>').val(url).attr('checked', !!checked).appendTo($label),
          $tag = $('<span class="source-tag">IGB</span>').appendTo($label),
          $span = $('<span class="secondary"/>').text(url.replace(/^https?:\/\//, '')).appendTo($label);
        return $li;
      }
                                                      
      function loadGenomesFromUCSC() {
        // On first load, load UCSC genomes
        $.ajax(o.ajaxDir+'chromsizes.php', {
          dataType: 'json',
          success: function(data) {
            $genomeList.find('.ucsc').remove();
            $genomeList.removeClass('loading');
            _.each(data.reverse(), function(v) {
              var $li = makeGenomeListLi('UCSC', v.db, v.species, v.assemblyDate);
              if (v.otherKeywords) { 
                $('<span class="hidden other-keywords"/>').text(v.otherKeywords).appendTo($li); 
              }
              $li.data('metadata', v).prependTo($genomeList);
            });
          }
        });
      }

      function loadDefaultIGBSources() {
        $.ajax(o.ajaxDir+'igb.php', {
          dataType: 'json',
          success: function(data) {
            var firstDir = true;
            _.each(data, function(genomes, dir) {
              makeGenomeSourceLi(dir, firstDir).insertBefore($addIgbSource);
              self._igbQuickloadData[dir] = genomes;
              
              if (_.keys(genomes).length) {
                _.each(genomes, function(v, k) {
                  var $li = makeGenomeListLi('IGB', dir + '/' + k, k, v, dir);
                  $li.toggleClass('hidden', !firstDir).appendTo($genomeList);
                });
              }
              firstDir = false;
            });
          }
        });
      }
      
      function addNewIGBSource() {
        var url = prompt('Please enter the URL of the IGB Quickload site', 'http://igbquickload.org/quickload/');
        if (url === null) { return; } else if (!(/^https?:\/\//).test(url)) { url = 'http://' + url; }
        url = url.replace(/\/+$/, '');

        function populateList(url) {
          _.each(self._igbQuickloadData[url], function(v, k) {
            makeGenomeListLi('IGB', url + '/' + k, k, v, url).appendTo($genomeList);
          });
        }

        if (self._igbQuickloadData[url]) { populateList(url); }
        else {
          $.ajax(o.ajaxDir+'igb.php', {
            data: { url: url, limit: $chromSizesLimit.val() },
            dataType: 'json',
            success: function(data) {
              _.extend(self._igbQuickloadData, data);
              makeGenomeSourceLi(url, true).insertBefore($addIgbSource);
              populateList(url);
            }
          });
        }
      }
      
      function loadGenomesFromGenBank(search) {
        if (search === _lastGenBankSearch) { return; }
        _lastGenBankSearch = search;
        $genomeDialog.find('.type-more').removeClass('active').hide();
        
        if (search.length <= 2) { 
          if (search.length >= 1) { $genomeDialog.find('.type-more').addClass('active').show(); }
          $genomeList.find('.choice.genbank').remove(); 
          return;
        }
        
        $genomeDialog.find('.genbank-loading').addClass('active').show();
        $.ajax(o.ajaxDir+'ncbi.php', {
          data: { search: search },
          dataType: 'json',
          success: _.partial(function(search, data) {
            var prevSelectedGenBank = $genomeList.find('.choice.genbank.focus:not(.hidden)').data('db');
            if (search !== _lastGenBankSearch) { return; }
            $genomeDialog.find('.genbank-loading').removeClass('active').stop().fadeOut();
            $genomeList.find('.choice.genbank').remove();
            _.each(data.nucleotide, function(v, k) {
              makeGenomeListLi('GenBank', 'nucleotide:' + v.uid, v.accession, v.title, 'genbank').appendTo($genomeList);
            });
            filterGenomeList(true);
            if (prevSelectedGenBank) { $genomeList.find('.choice.genbank:not(.hidden)'); }
          }, search)
        });
      }
      
      function ensureSelectedChoiceVisible() {
        var $selectedVisibleChoice = $genomeList.find('.choice.focus:not(.hidden)'),
            oldScrollTop = $genomeList.scrollTop(),
            padTop = 10,
            padBottom = 25,
            bottomLimit = $genomeList.outerHeight() - $selectedVisibleChoice.outerHeight(),
            $firstVisibleChoice = $genomeList.scrollTop(0).children('.choice:not(.hidden)');
        if ($selectedVisibleChoice.length === 0) {
          if ($firstVisibleChoice.length > 0) { $firstVisibleChoice.eq(0).click(); }
          else { 
            $genomeDialog.find('.contigs-loading,.ui-state-error').removeClass('active').hide();
            updateSaveBtnState(); 
          }
        } else {
          var newScrollTop = $selectedVisibleChoice.offset().top - $genomeList.offset().top + oldScrollTop - padTop;
          newScrollTop = Math.max(newScrollTop - bottomLimit + padBottom, Math.min(oldScrollTop, newScrollTop)); 
          $genomeList.scrollTop(newScrollTop);
        }
      }
      
      function filterGenomeList(dontLoadGenBank) {
        var searchTerms = _.map($filterGenomes.val().split(/\s+/), function(t) { return t.toLowerCase(); }),
            sources = $genomeDialog.find('[name=source]:checked').map(function() { return $(this).val(); }).get();
        searchTerms = _.reject(searchTerms, function(t) { return t === ''; });
        $genomeList.children('.choice').each(function() {
          var v = $(this).text().toLowerCase(),
            source = $(this).data('source'),
            termsFound = _.reduce(searchTerms, function(memo, t){ return memo + (v.indexOf(t) !== -1 ? 1 : 0); }, 0),
            visible = (searchTerms.length === 0 || termsFound == searchTerms.length) && _.contains(sources, source);
          $(this).toggleClass('hidden', !visible);
        });
        ensureSelectedChoiceVisible();
        if (dontLoadGenBank !== true && _.contains(sources, 'genbank')) { loadGenomesFromGenBank(searchTerms.join(' ')); }
      }
      
      function filterGenomesKeydown(e) {
        var method = e.which == 40 ? 'nextAll' : (e.which == 38 ? 'prevAll' : false);
        if (e.which == 13) { $genomeDialog.find('[name=save]').click(); }
        else if (method) {
          $genomeList.find('.choice.focus')[method]('.choice:not(.hidden)').eq(0).click();
          ensureSelectedChoiceVisible();
          return false;
        }
      }
      
      function genomeListChoiceClicked(e) {
        var $choice = e.type == 'click' ? $(e.target).closest('.choice') : $(this).find('.choice.focus'),
            db = $choice.addClass('focus').data('db'),
            metadata = $choice.data('metadata') || {},
            sourceType = $choice.hasClass('ucsc') ? 'ucsc' : ($choice.hasClass('igb') ? 'igb' : 'genbank'),
            ajaxUrl = sourceType === 'ucsc' ? o.ajaxDir+'chromsizes.php' : o.ajaxDir+'igb.php',
            params = sourceType === 'ucsc' ? { db: db } : { url: db };
        $(this).find('.choice').not($choice).removeClass('focus');
        if (!db) { return; }
        if (sourceType === 'genbank') { loadedChromSizes({db: db}, sourceType); return; }
        $genomeDialog.find('.contigs-loading').addClass('active').show();
        $genomeDialog.find('.ui-state-error, .contig-load-error, .skipped-warning').hide();
        updateSaveBtnState();
        $.ajax(ajaxUrl, {
          data: _.extend({ limit: $genomeDialog.find('[name=limit]').val() }, params),
          dataType: 'json',
          success: _.partial(function($choice, data) {
            if (!$choice.hasClass('focus')) { return; }
            loadedChromSizes(_.extend({}, metadata, data), sourceType); 
          }, $choice)
        });
        $genomeDialog.find('[name=filterGenomes]').focus();
      }

      function loadedChromSizes(data, sourceType) {
        $genomeDialog.find('.contigs-loading').removeClass('active').stop().fadeOut();
        if (data.error) {
          $genomeDialog.find('.skipped-num').text(data.skipped);
          $genomeDialog.find('[name=chromsizes]').val('');
          $genomeDialog.find('.ui-state-error').fadeIn().children('.contig-load-error').show();
        } else {
          if (data.chromsizes) { $genomeDialog.find('[name=chromsizes]').val(data.chromsizes); }
          $genomeDialog.find('[name=name]').val(data.db);
          $genomeDialog.data('genomeMetadata', data);
          $genomeDialog.data('genomeSourceType', sourceType);
          if (data.skipped) {
            $genomeDialog.find('.skipped-num').text(data.skipped);
            $genomeDialog.find('.ui-state-error').fadeIn().children('.skipped-warning').show();
          } else {
            $genomeDialog.find('.ui-state-error').hide();
          }
        }
        updateSaveBtnState();
      }

      $genomeDialog.bind('open.genobrowser', function() {
        var $sourceList = $genomeDialog.find('.source-list'),
          $chromSizesLimit = $genomeDialog.find('[name=limit]'),
          $newIgbDir = $genomeDialog.find('.add-choice button');
        $(o.genomePicker[1]).trigger('close.genobrowser');
        updateSaveBtnState();
        if ($genomeDialog.hasClass('initialized')) { return; }

        // the following only runs once, to initialize this dialog's UI
        $genomeDialog.find('button').button();
        hoverClasses($genomeDialog.find('.clickable'));
        $genomeDialog.find('.ui-state-error, .contig-load-error, .skipped-warning').hide();
        updateSaveBtnState();

        // loads the initial lists of available genomes from UCSC & IGB Quickload directories
        loadGenomesFromUCSC();
        loadDefaultIGBSources();

        // implements filtering by keyword and by source
        $filterGenomes.bind('keyup change search', function(e) { filterGenomeList(); }); 
        $filterGenomes.bind('keydown', filterGenomesKeydown)
        $sourceList.bind('change', function(e) { $(e.target).is(':checkbox') && filterGenomeList(); });

        // load the chrom sizes data when selecting a UCSC or IGB genome
        $genomeList.bind('click change', genomeListChoiceClicked);
        $chromSizesLimit.change(function() { $genomeList.trigger('change'); });

        // load the contents.txt of an IGB Quickload directory when selecting its URL
        $newIgbDir.click(addNewIGBSource);

        $genomeDialog.addClass('initialized');
      });
      
      $genomeDialog.find('[name=chromsizes]').one('focus', function() {
        var $this = $(this).removeClass('placeholder');
        updateSaveBtnState();
        _.defer(function() { $this.select(); });
      });
      
      $genomeDialog.find('[name=save]').click(function(e, sourceType) {
        var metadata = { format: 'chromsizes' },
          remoteMetadata = $genomeDialog.data('genomeMetadata'),
          activeTab = $chromSizesTabs.tabs('option', 'selected'),
          sourceTypesForTabs = [$genomeDialog.data('genomeSourceType'), 'pasted-data', 'chromsizes'],
          origMetadata, chromSizes, parts, translatedUrl;
        sourceType = sourceType || sourceTypesForTabs[activeTab];
        if (sourceType == 'pasted-data') {
          return handlePastedData();
        } else if (sourceType == 'genbank') {
          parts = remoteMetadata.db.split(':');
          translatedUrl = o.ajaxDir + 'ncbi.php?db=' + parts[0] + '&uid=' + parts[1];
          return handlePastedData({url: translatedUrl, message: ' from GenBank', meta: {ncbi: remoteMetadata.db}});
        } else if (sourceType == 'ucsc' || sourceType == 'igb') {
          // This is an unaltered set of chromosome sizes pulled from UCSC or an IGB Quickload directory
          chromSizes = remoteMetadata.chromsizes;
          metadata.name = remoteMetadata.db;
          _.each(['tracks', 'moreTracks', 'categories', 'cytoBandIdeo', 'species', 'assemblyDate'], function(k) {
            metadata[k] = remoteMetadata[k];
          });
          origMetadata = remoteMetadata;
          if (sourceType == 'ucsc') {
            metadata.ucsc = metadata.name + ':' + remoteMetadata.limit;
          } else {
            metadata.species = metadata.species || metadata.name;
            metadata.igb = remoteMetadata.limit + ':' + metadata.name;
          }
        } else {
          chromSizes = $genomeDialog.find('[name=chromsizes]').val();
          metadata.name = $genomeDialog.find('[name=name]').val();
        }
        CustomGenomes.parseAsync(chromSizes, metadata, function(genome) {
          self._setOptions(genome.options({ width: self.lineWidth() * self.$lines.length }));
        });
      });
    },

    // This initializes everything on the "Open file or URL" tab of the custom genomes dialog
    // and then kicks off to _initCustomGenomeFromDatabase above to setup the other tabs
    _initCustomGenomeDialog: function() {
      var self = this,
        o = self.options,
        $genomeDialog = $(o.dialogs[4]).closest('.ui-dialog'),
        $chromSizesTabs = $genomeDialog.find('.tabs'),
        $pasteGenomeData = $genomeDialog.find('[name=customGenomePaste]'),
        $add = $genomeDialog.find('.form-line').first(),
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        fileInputHTML = '<input type="file" name="genomeFile"/>';

      function customGenomeError(e) {
        $genomeDialog.find('.spinner').hide();
        self.showWarning(err.message.replace(/^Uncaught \w+: /, ''), err);
        replaceFileInput();
      }
      
      function customGenomeParse(data, metadata, $spinner, callback) {
        CustomGenomes.parseAsync(data, metadata, function(genome) {
          self._setOptions(genome.options({ width: self.lineWidth() * self.$lines.length }));
          $spinner.hide();
          $genomeDialog.fadeOut();
          _.isFunction(callback) && callback();
        });
      }

      function handleFileSelect(e) {
        var reader = new FileReader(),
          $add = $(e.target).closest('.form-line'),
          $spinner = $add.find('.spinner').show();

        $overlay.show();
        $overlayMessage.show().text('Loading custom genome...');

        if (e.target.files.length) {
          reader.onload = (function(f) {
            var metadata = { file: f.name };
            return function(ev) { customGenomeParse(ev.target.result, metadata, $spinner); };
          })(e.target.files[0]);
          reader.readAsText(e.target.files[0]);
        }
        replaceFileInput();
      }
      
      function replaceFileInput() {
        _.defer(function() {
          $genomeDialog.find('[name=genomeFile]').replaceWith(fileInputHTML);
          $genomeDialog.find('[name=genomeFile]').change(handleFileSelect);
        });
      }
      
      if (window.File && window.FileReader && window.FileList) {
        $add.find('label').html(fileInputHTML);
        $add.find('[name=genomeFile]').change(handleFileSelect);
        $add = $add.nextAll('.form-line').first();
      } else {
        $add.remove();
        $genomeDialog.find('.help-line').first().remove();
        $add = $genomeDialog.find('.form-line').first();
      }

      function handlePastedData(databaseLink) {
        var $add = $pasteGenomeData.closest('.form-line'),
          $spinner = $add.find('.spinner').show(),
          pastedData = $.trim($pasteGenomeData.val()),
          clearTextarea = function() { $pasteGenomeData.val(''); },
          url = databaseLink ? databaseLink.url : pastedData,
          fromMessage = (databaseLink ? (databaseLink.message || '') : '');
        $overlay.show();
        $overlayMessage.show().text('Loading custom genome' + fromMessage + '...');
        if ((databaseLink && databaseLink.url) || (/^https?:\/\/.*$/).test(pastedData)) {
          $.ajax(url, {
            dataType: "text",
            success: function(data) {
              customGenomeParse(data, databaseLink ? databaseLink.meta : {url: url}, $spinner, clearTextarea);
            },
            progress: function(loaded, total) {
              var $progress = $overlayMessage.find('.ui-progressbar');
              if (!$progress.length) { $progress = $('<div/>').appendTo($overlayMessage).progressbar(); }
              $progress.progressbar('value', loaded/total * 100);
            },
            error: function() {
              $overlay.hide();
              $overlayMessage.hide();
              customGenomeError({message: "No valid custom track data was found at this URL."});
            }
          });
        } else {
          customGenomeParse(pastedData, { file: "_pasted_data" }, $spinner, clearTextarea);
        }
      }
      
      function updateSaveBtnState() {
        var activeTab = $chromSizesTabs.tabs('option', 'selected'),
          $chromsizes = $genomeDialog.find('[name=chromsizes]'),
          $saveBtn = $genomeDialog.find('[name=save]').button('disable').removeClass('glowing');
                  
        if (activeTab === 1) {
          // Pasted data; we don't worry about the <input type="file"> as it loads automatically onchange
          if ($.trim($pasteGenomeData.val()).length === 0) { return; }
        } else {
          if (activeTab === 0) { // "From a database" tab
            _.defer(function() { $genomeDialog.find('[name=filterGenomes]').focus(); });
            $genomeDialog.find('.genome-list .choice.hidden').removeClass('focus');
            if ($genomeDialog.find('.contigs-loading').hasClass('active')) { return; } // Contigs still loading
            if ($genomeDialog.find('.genome-list .choice.focus:not(.hidden)').length === 0) { return; } // Nothing selected
          } else if ($chromsizes.hasClass('placeholder')) { return; } // "Specify contig sizes" tab
          // Neither of these tabs can load anything if there is no chromsizes data entered/crossloaded
          if ($.trim($chromsizes.val()).length == 0) { return; }
        }
        $saveBtn.button('enable').addClass('glowing');
      }
      $pasteGenomeData.bind('keyup change', function(e) { _.defer(updateSaveBtnState); });
      $chromSizesTabs.tabs({ select: function(e) { _.defer(updateSaveBtnState); } });
      
      // This initializes the other two tabs, about loading genomes from other sources (UCSC, IGB, etc)
      self._initCustomGenomeFromDatabase(handlePastedData, updateSaveBtnState);
    },

    _initWarningsDialog: function() {
      var self = this,
        o = self.options,
        $warningsButton = $(o.warnings[0]).button().hide();
      self.$warningsDialog = $(o.dialogs[7]).closest('.ui-dialog');
      $warningsButton.click(function() { self.$warningsDialog.trigger('open'); });
    },

    _initFromParams: function(params, suppressRepeat) {
      var self = this,
        o = self.options,
        $elem = self.element,
        $overlay = $(o.overlay[0]),
        $overlayMessage = $(o.overlay[1]),
        $customPicker = $(o.trackPicker[3]),
        $genomeDialog = $(o.dialogs[4]).closest('.ui-dialog'),
        $trackUrlInput = $customPicker.find('[name=customPaste]'),
        $trackUrlGet = $customPicker.find('[name=customPasteAdd]'),
        $genomeUrlInput = $genomeDialog.find('[name=customGenomePaste]'),
        remoteGenomeSettings = {
          ucsc: { url: 'chromsizes.php', messageText: 'from UCSC' },
          igb: { url: 'igb.php', messageText: 'via IGB Quickload' }
        },
        sessionVars = {},
        urlParams = $.urlParams(),
        customTracksArray, customGenomePieces, customGenomeSource, customGenomeName, chromSizes, trackSpec,
          remote, remoteParams;

      function persistentCookie(k, v) { $.cookie(k, v, {expires: 60}); }
      function removeCookie(k) { $.cookie(k, null); }
      persistentCookie('db', o.genome);
      self.storage = {
        session: window.sessionStorage || {setItem: $.cookie, getItem: $.cookie, removeItem: removeCookie},
        persistent: window.localStorage || {setItem: persistentCookie, getItem: $.cookie, removeItem: removeCookie}
      };
      _.each(o.savableParams, function(keys, dest) {
        _.each(keys, function(k) {
          var v = self.storage[dest].getItem((dest != 'persistent' ? (urlParams.db || o.genome) + '.' : '') + k);
          if (v !== null) { sessionVars[k] = v; }
        });
      });
      params = params || _.extend({}, sessionVars, urlParams);

      if (suppressRepeat && self._lastParams && _.isEqual(self._lastParams, params)) { return; }
      self._lastParams = _.clone(params);

      customTracksArray = _.compact([].concat(params.customTracks)),
      self._customTrackUrls.requested = _.union(self._customTrackUrls.requested, customTracksArray);
      var unprocessedUrls = _.difference(self._customTrackUrls.requested, self._customTrackUrls.processing);

      // We need to load a custom genome
      if (params.db != o.genome) {
        customGenomePieces = (params.db || '').split(':');
        customGenomeSource = customGenomePieces[0];
        remote = remoteGenomeSettings[customGenomeSource];
        
        if (customGenomeSource == 'url') {   // It's a URL to a full genome file
          $genomeUrlInput.val(customGenomePieces.slice(1).join(':'));
          $genomeDialog.find('[name=save]').trigger('click', ['pasted-data']);
          self._nextDirectives = params;
          return;
        } else if (customGenomeSource == 'ncbi') {  // It's a genome to crossload from GenBank
          $genomeDialog.data('genomeMetadata', {db: customGenomePieces.slice(1).join(':')});
          $genomeDialog.find('[name=save]').trigger('click', ['genbank']);
          self._nextDirectives = params;
          return;
        } else if (remote) {
          // It's a genome stored at UCSC or in an IGB Quickload directory
          $overlay.show();
          $overlayMessage.show().text('Loading genome ' + remote.messageText + '...');
          if (customGenomeSource == 'ucsc') {
            remoteParams = {
              db: customGenomePieces[1],
              tracks: params.tracks ? params.tracks.replace(/:\d+/g, '') : '',
              limit: customGenomePieces[2],
              meta: 1
            };
          } else if (customGenomeSource == 'igb') {
            remoteParams = { url: customGenomePieces.slice(2).join(':'), limit: customGenomePieces[1] };
          } else { throw "Unrecognized custom genome source " + customGenomeSource; }
          
          $.ajax(o.ajaxDir + remote.url, {
            data: remoteParams,
            dataType: 'json',
            success: function(data) {
              if (data.error) {
                $overlayMessage.text('Error loading genome data ' + remote.messageText);
              } else {
                $genomeDialog.data('genomeMetadata', data);
                $genomeDialog.find('[name=save]').trigger('click', [customGenomeSource]);
                self._nextDirectives = params;
              }
            }
          });
          return;
        } else if ((/^custom[:|]/).test(params.db)) {   // It's a custom chrom.sizes
          chromSizes = params.db.replace(/^[^|]+\|/, '').replace(/:/g, "\t").replace(/\|/g, "\n");
          $genomeDialog.find('[name=chromsizes]').val(chromSizes);
          customGenomeName = (params.db[6] == ':') ? params.db.substring(7).replace(/\|.*/, '') : '';
          $genomeDialog.find('[name=name]').val(customGenomeName);
          $genomeDialog.find('[name=save]').trigger('click', ['chromsizes']);
          self._nextDirectives = params;
          return;
        }
      }

      // If there are custom track URLs somewhere in the parameters that have not been processed yet
      // they need to be loaded before we can make sense of the rest of the params
      if (unprocessedUrls.length) {
        $overlay.show();
        $overlayMessage.show().text('Loading custom track...');
        $trackUrlInput.val(unprocessedUrls[0]); $trackUrlGet.click();
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

    // =========================================================
    // = The following functions handle parsing of custom data =
    // =========================================================

    _parseCustomGenomeTracks: function(tracksToParse, finishSetup, posAfterParsing) {
      var self = this,
        $elem = self.element,
        o = self.options,
        finishSetupAfterParsing;

      function browserOpts(trackName) {
        var opts = {
          bppps: o.bppps,
          chrPos: self.chrPos,
          genome: o.genome,
          pos: posAfterParsing ? posAfterParsing.pos : self.pos,
          chrLengths: o.chrLengths,
          genomeSize: o.genomeSize,
          ajaxDir: o.ajaxDir
        };
        if (trackName == 'ruler') { 
          opts.chrBands = o.chrBands;
          opts.chrLabels = o.chrLabels;
        }
        return opts;
      }

      if (tracksToParse.length > 0) {
        finishSetupAfterParsing = _.after(tracksToParse.length, finishSetup);
        _.each(tracksToParse, function(t) {
          // Allow for inheritance of options from parent tracks (e.g. subtracks inheriting from compositeTracks)
          var parentOpts = t.parent && self.compositeTracks[t.parent] && self.compositeTracks[t.parent].opts;
          CustomTracks.parseAsync(t.customData, browserOpts(t.n), parentOpts, function(customTracks) {
            var customTrack = customTracks[0]; // t.customData should only contain data for one track
            _.each(o.bppps, function(bppp) {
              self.availTracks[t.n].fh[o.bpppFormat(bppp)] = {dense: customTrack.heights.min};
            });
            self.availTracks[t.n].custom = t.custom = customTrack;
            delete customTrack.customData;
            finishSetupAfterParsing();
          });
        });
      } else { finishSetup(); }
    },

    // =====================================================================================
    // = The following functions coordinate the display of browser lines ($.ui.genoline's) =
    // =====================================================================================

    // Fix the number of lines displayed vertically, shifting and unshifting lines to fill the vertical space
    // You can specify the line index to holdSteady (keep in roughly the same place), and animOpts for the animation
    _fixNumLines: function(holdSteady, animOpts) {
      var self = this,
        $elem = self.element,
        o = self.options,
        availHeight = $elem.innerHeight(),
        lineHeight = self._lineHeight(),
        numLines = self.$lines.length,
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
          currTop = self.$lines.eq(holdSteady).position().top;
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
      unShiftLines > 0 ? self._addLines(-unShiftLines) : self._removeLines(unShiftLines, animOpts);
      pushLines > 0 ? self._addLines(pushLines) : self._removeLines(-pushLines, animOpts);
      self.centralLine = Math.ceil(newNumLines / 2) - 1;
      self._pos(self.pos - unShiftLines * self.bpWidth());
      // Only fire a completion callback once for the whole browser
      if (animOpts && animOpts.complete) { animOpts.complete = _.after(self.$lines.length, animOpts.complete); }
      self.$lines.each(function(i) {
        var newTop = i * extraLineHeight + extraTopMargin;
        $(this).data('naturalTop', newTop);
        if (holdSteady && holdSteady.exceptFor == this) { return; }
        $(this).animate({top: newTop}, $.extend({
          duration: o.lineFixDuration,
          queue: false,
          easing: 'easeInOutQuart'
        }, animOpts));
      });
      self._updateReticle(null, animOpts);
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
        if (!_.include(prevTracks, name)) {
          o.tracks.splice(i, 0, $.extend({}, self.availTracks[name], spec.h ? {h: spec.h} : {}));
        }
      });

      self.$lines.genoline('fixTracks');
      self._fixNumLines(0, animOpts);
      if (prevPos < o.genomeSize && prevPos > 0 && (!animOpts || !animOpts.complete)) { self.jumpTo(prevPos); }
      if (!externalTrackSpec) { this._saveParamsDebounced(); }
    },

    // Hides the track as specified by its name
    hideTrack: function(name) {
      var self = this,
        $checkboxes = self.$trackPicker.find(':checkbox').add(self.$customTracks.find(':checkbox'));
      $checkboxes.filter('[name="'+name+'"]').attr('checked', false).change();
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

      // Pull the trackSpec from the state of the checkboxes, or vice versa if trackSpec was provided
      if (!trackSpec || !_.isArray(trackSpec) || !trackSpec.length) {
        trackSpec = [];
        $checkboxes.filter(':checked').each(function() {
          var n = $(this).attr('name');
          if (self.availTracks[n]) { trackSpec.push({n: n}); }
        });
      } else {
        // Cleanup external trackSpecs: for now, disallow dupes, and make sure all tracks actually exist
        trackSpec = _.uniq(_.filter(trackSpec, function(t) { return self.availTracks[t.n]; }), 'n');
        $checkboxes.attr('checked', false);
        _.each(trackSpec, function(t) { $checkboxes.filter('[name="'+t.n+'"]').attr('checked', true); });
      }

      // For checkboxes on composite tracks, use the "indeterminate" state if a fraction of child tracks are selected
      $checkboxes.filter('.composite').each(function() {
        var $li = $(this).closest('.choice'),
          $ul = $li.find('ul:first'),
          childrenChecked = $ul.find(':checked:not(.composite)').length,
          childrenTotal = $ul.find(':checkbox:not(.composite)').length,
          partiallyLoaded = $li.hasClass('unloaded') || $ul.find('.choice.composite.unloaded').length > 0;
        if (!partiallyLoaded && childrenChecked > 0 && childrenChecked == childrenTotal) {
          $(this).attr('checked', true).data('indeterminate', false).get(0).indeterminate = false;
        } else if (childrenChecked > 0) {
          $(this).attr('checked', false).data('indeterminate', true).get(0).indeterminate = true;
        } else {
          $(this).attr('checked', false).data('indeterminate', false).get(0).indeterminate = false;
        }
      });

      // if there is only one newTrack, disable the checkbox so there are always >=1 tracks
      if (trackSpec.length === 1) { $checkboxes.filter(':checked').attr('disabled', true); }
      else { $checkboxes.attr('disabled', false); }
      return trackSpec;
    },

    // Resets to the default set of tracks
    _resetToDefaultTracks: function() {
      this._fixTracks(false, this.defaultTracks);
      this._saveParamsDebounced();
    },

    // Filters the tracks within the track list, and if o.searchableTracks is a URL, fetches more tracks that can be added
    _searchTracks: function(query) {
      var self = this,
        o = self.options,
        lastQuery = self._lastTrackSearch,
        $searchBar = $(o.trackPicker[1]).find('.search-bar').eq(0),
        $search = $searchBar.find('input[type=search]'),
        $list = $(o.trackPicker[1]).children('ul').eq(0),
        $warn = $list.children('.search-warn'),
        canLoadMoreTracks = o.custom && o.custom.canSearchTracks && query.length >= 3,
        numResults, warnText;

      query = query.toLowerCase();
      if (!o.searchableTracks) { return; }
      if (query === lastQuery) { return; }

      function matches(elem, q) {
        var $elem = $(elem),
            $desc = $elem.find('.desc').eq(0),
            $composite = !$elem.hasClass('composite') && $elem.closest('.composite').find('.desc').eq(0),
            text = "" + $desc.find('h3.name>span').text() + " " + $desc.find('.long-desc').text();
        text += " " + $elem.find('input').attr('name');
        text += " " + $elem.closest('.category-section').children('.category-header').text();
        if ($composite && $composite.length) {
          text += " " + $composite.find('h3.name>span').text() + " " + $composite.find('.long-desc').text();
        }
        text = text.toLowerCase();
        return _.every(q.split(/[\s,]+/), function(word) { return text.indexOf(word) !== -1; });
      }

      function toggleChoices(q, willLoadMoreTracks) {
        $list.find('.choice').each(function() {
          var match = matches(this, q);
          $(this).toggle(match).toggleClass('matches', match);
        });
        $list.find('.category-section, .choice.composite').each(function() {
          var $li = $(this),
            $innerUl = $li.children('ul').eq(0),
            matchWithin = $innerUl.find('.choice.matches').length > 0;
          if ($li.hasClass('category-section')) { $li.toggle(matchWithin); }
          if ($li.is('.choice.composite') && matchWithin) { $li.show(); }
          if (query !== '') {
            $li.find('.collapsible-btn').eq(0).toggleClass('collapsed', !matchWithin);
            $innerUl.toggle(matchWithin);
          }
          // Forcibly collapse unloaded or partially loaded composite tracks if they no longer match the query
          if ($li.hasClass('unloaded') && (!matchWithin || query === '')) {
            $li.find('.collapsible-btn').eq(0).addClass('collapsed');
            $innerUl.hide();
          }
        });
        numResults = $list.find('.choice.matches').length;
        warnText = numResults > 0 ? 'Showing only tracks matching the search query.' : 'No tracks match this search query.';
        if (willLoadMoreTracks) { warnText = 'Searching for more tracks...'; }
        $warn.toggle(query !== '').toggleClass('still-loading', willLoadMoreTracks).text(warnText);
      }

      toggleChoices(query, canLoadMoreTracks);
      self._lastTrackSearch = query;
      
      // If supported by the genome, search for more tracks on the server that match, and add them to the picker.
      if (canLoadMoreTracks) {
        o.custom.searchTracksAsync({search: query}, function(newOpts) {
          // Too late! We've already searched for something else.
          if (newOpts._searchParams.search !== self._lastTrackSearch) { return; }
          
          // Only need to handle new tracks--if it's in self.availTracks it's already in the trackpicker UI.
          newOpts.availTracks = _.filter(newOpts.availTracks, function(t) { return !self.availTracks[t.n]; });
          Array.prototype.push.apply(o.availTracks, newOpts.availTracks);
          newOpts.compositeTracks = _.filter(newOpts.compositeTracks, function(t) { return !self.compositeTracks[t.n]; });
          if (newOpts.compositeTracks.length) { throw "Not supposed to receive new composite tracks when searching!"; }
          _.each(newOpts.availTracks, function(v) { self.availTracks[v.n] = $.extend({}, v, {oh: v.h}); });
          _.extend(o.trackDesc, newOpts.trackDesc);
          
          if (!newOpts.availTracks.length) { 
            toggleChoices(query, false);
            return;
          }
          self._parseCustomGenomeTracks(newOpts.availTracks, function() {
            var allTracks = o.availTracks.concat(o.compositeTracks);
            
            // Update the child tracks for any composite tracks that were affected by adding these new tracks
            _.each(_.uniq(_.pluck(newOpts.availTracks, "parent")), function(n) {
              var childTracks = self._sortedTracks(_.filter(allTracks, function(t) { return t.parent == n; })),
                $li = $list.find(':checkbox[name="'+n+'"]').closest('li.choice'),
                $innerUl = $li.children('ul').eq(0);
              if ($li.hasClass('unloaded')) { $innerUl.empty(); }
              self._addTracks(childTracks, $innerUl);
            });
            
            // Finally, update the hidden/shown tracks in the picker once more to match the query.
            toggleChoices(query, false);
          });
        });
      }
    },

    // Adds non-custom tracks to the track picker, also adds them to o.availTracks and self.availTracks as necessary
    _addTracks: function(tracks, to, loadedUpToPriority) {
      var self = this,
        o = self.options,
        d = o.trackDesc,
        allTracks = self._sortedTracks(o.availTracks.concat(o.compositeTracks)),
        $ul = to ? $(to) : $(o.trackPicker[1]).children('ul').eq(0);

      _.each(tracks, function(t) {
        // TODO: Provide download links for custom tracks that have bigDataUrl? Or even for small formats too?
        var n = t.n,
          composite = !!t.c,
          $li = $('<li class="choice"/>').appendTo($ul),
          $l = $('<' + (composite ? 'div' : 'label') + ' class="clickable"/>').appendTo($li),
          $c = $('<input type="checkbox"/>').attr('name', n).prependTo($('<div class="chk"/>').prependTo($l)),
          $d = $('<div class="desc"/>').appendTo($l),
          db = o.genome.split(':'),
          $mb = $('<div class="ui-buttonset more-btns"/>'),
          href = o.trackDescURL + '?db=' + (db[0] === 'ucsc' ? db[1] : db[0]) + '&g=' + n + '#TRACK_HTML',
          $am = d[n].lg && $('<a class="more" target="_blank"><img src="css/question.svg" class="zondicon"/></a>'),
          $ac = t.custom && $('<a class="opts"><img src="css/cog.svg" class="zondicon"/></a>'),
          $span = $('<span/>').text(d[n].sm),
          moreBtns = !!$am + !!$ac,
          $hov = $l,
          $innerUl, childTracks, childTracksUnderPriority;

        if (!composite && !self.availTracks[t.n]) {
          o.availTracks.push(t);
          self.availTracks[t.n] = $.extend({}, t);
        }

        $('<h3/>').addClass('name').append($span).appendTo($d);
        if ($am) { $am.attr({href: href, title: "More info about this track"}).button().appendTo($mb); } 
        if ($ac) { $ac.attr('title', "Options").button().click(_.bind(self.editCustomTrack, self, n)).appendTo($mb); }
        if (moreBtns) { $mb.appendTo($li); $hov = $hov.add($mb); }
        if (moreBtns > 1) {
          $mb.children('.ui-button').removeClass('ui-corner-all').eq(0).addClass('ui-corner-left');
          $mb.children('.ui-button').eq(-1).addClass('ui-corner-right');
        }
        if (d[n].lg) { $('<p/>').addClass('long-desc').text(d[n].lg).appendTo($d); }

        if (composite) {
          $l.add($c).add($li).addClass('composite');
          $l.click(_.bind(self._trackPickerClicked, self));
          $('<div class="collapsible-btn collapsed"><div class="arrow"/></div>').insertBefore($d);
          $innerUl = $('<ul/>').hide().appendTo($li);
          childTracks = self._sortedTracks(_.filter(allTracks, function(t) { return t.parent == n; }));
          childTracksUnderPriority = _.filter(childTracks, function(t) {
            return t.custom ? t.custom.opts.priority <= loadedUpToPriority : true;
          });

          // Recursively add children tracks if they are already provided in o.availTracks/o.compositeTracks
          if (childTracks.length > 0) {
            self._addTracks(childTracks, $innerUl, loadedUpToPriority);
            _.each(childTracks, function(t) { $innerUl.find('input:checkbox[name='+t.n+']').addClass('default'); });
          }
          if (loadedUpToPriority ? !childTracksUnderPriority.length : !childTracks.length) {
            $li.addClass('unloaded');
          }
        } else {
          if (_.find(o.tracks, function(trk) { return trk.n==n; })) { $c.attr('checked', true); }
        }

        $l.bind('click', function(e) { if ($(e.target).is('a')) { e.stopPropagation(); }});
        $l.attr('title', n + (d[n].lg && d[n].lg.length > 58 ? ': ' + d[n].lg : ''));
        $hov.hover(function() { $hov.addClass('hover'); }, function() { $hov.removeClass('hover'); });
        $c.bind('change', _.bind(self._fixTracks, self));
      });
    },

    // A click handler for the track picker, which can (1) collapse/uncollapse sections and composite
    // tracks and (2) load and add more tracks via o.custom.searchTracksAsync as necessary.
    _trackPickerClicked: function(e) {
      var self = this,
        o = self.options,
        $target = $(e.target),
        $li = $target.closest('li'),
        $ul = $li.children('ul').eq(0),
        $btn = $li.find('.collapsible-btn').eq(0),
        $chk = $li.find('input:checkbox').eq(0),
        unloadedChildren = $li.hasClass('unloaded') && !$li.hasClass('loading'),
        collapsed = $btn.hasClass('collapsed'),
        isHeader = $li.hasClass('category-section'),
        $defaults;

      function loadChildren(callback) {
        o.custom.searchTracksAsync({children_of: $chk.attr('name')}, function(newOpts) {
          Array.prototype.push.apply(o.availTracks, newOpts.availTracks);
          Array.prototype.push.apply(o.compositeTracks, newOpts.compositeTracks);
          _.each(newOpts.availTracks, function(v) { self.availTracks[v.n] = $.extend({}, v, {oh: v.h}); });
          _.each(newOpts.compositeTracks, function(v) { self.compositeTracks[v.n] = v; });
          _.extend(o.trackDesc, newOpts.trackDesc);

          self._parseCustomGenomeTracks(newOpts.availTracks, function() {
            self._addTracks(self._sortedTracks(newOpts.availTracks.concat(newOpts.compositeTracks)), $ul, 100);
            _.each(newOpts.tracks, function(t) { $ul.find('input:checkbox[name='+t.n+']').addClass('default'); });
            $li.removeClass('loading unloaded');
            callback(newOpts);
          });
        });
      }

      // Clicking composite track checkboxes may need to load and display subtracks...
      if ($(e.target).is($chk)) {
        if ($li.hasClass('composite')) {
          if (!$chk.data('indeterminate') && $chk.is(':checked')) {
            if (unloadedChildren) {
              loadChildren(function(newOpts) {
                _.each(_.first(newOpts.tracks, 10), function(t) {
                  $ul.find('input:checkbox[name='+t.n+']').attr('checked', true);
                });
                if (newOpts.tracks.length > 10 && $btn.hasClass('collapsed')) { $btn.click(); }
                $ul.find('input:checkbox').eq(0).change();
              });
            } else {
              $defaults = $ul.find('input:checkbox.default');
              if ($defaults.length > 0) { $defaults.slice(0, 10).attr('checked', true).eq(0).change(); }
              if ((!$defaults.length || $defaults.length > 10) && collapsed) { $btn.click(); }
            }
          } else {
            $ul.find('input:checkbox:not(.composite)').attr('checked', false).eq(0).change();
          }
        }
        return; // Checkbox clicks should not affect collapsed/uncollapsed elements.
      }

      // Handle collapsing and uncollapsing of composite tracks, including loading of subtracks
      if (collapsed) {
        if ($ul.children().length > 0 && !unloadedChildren) {
          $ul.slideDown();
          $btn.removeClass('collapsed');
        } else if (unloadedChildren && o.custom && o.custom.canSearchTracks) {
          $li.addClass('loading');
          $ul.empty();
          loadChildren(function() {
            $btn.hasClass('collapsed') && $ul.children().length && $btn.click();
            self._fixTracks();
          });
        }
      } else {
        $ul.slideUp();
        $btn.addClass('collapsed');
      }
    },

    // After a custom track file is parsed, this function is called to add them to the custom track picker and each
    // browser line; they are also inserted in self.availTracks just like "normal" tracks
    _addCustomTracks: function(fname, customTracks, url) {
      var self = this,
        o = self.options,
        $ul = $(o.trackPicker[3]).children('ul').eq(0),
        d = o.trackDesc,
        browserDirectives = _.extend({}, customTracks.browser, self._nextDirectives || {}),
        warnings = [],
        customTrackNames = _.map(customTracks, function(t, i) { return classFriendly('_'+fname+'_'+(t.opts.name || i)); }),
        newTracks = _.filter(customTrackNames, function(n) { return !self.availTracks[n]; }),
        nextDirectivesIncludeOneNewTrack = self._nextDirectives && self._nextDirectives.tracks &&
          !!_.find(self._nextDirectives.tracks.split('|'), function(v) { return _.contains(newTracks, v.split(':')[0]); });

      _.each(customTracks, function(t, i) {
        var n = customTrackNames[i],
          newTrack = !self.availTracks[n],
          $li, $l, $c, $d, $o;
        if (newTrack) {
          $li = $('<li class="choice"/>').appendTo($ul);
          $l = $('<label class="clickable"/>').appendTo($li);
          $c = $('<input type="checkbox"/>').attr('name', n).prependTo($('<div class="chk"/>').prependTo($l));
          $d = $('<div class="desc"></div>').appendTo($l);
          $o = $('<button class="opts"><img src="css/cog.svg" class="zondicon icon" alt="options"/></button>').appendTo($li),
          $l.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
          $l.attr('title', n);
          $c.bind('change', _.bind(self._fixTracks, self));
          $o.button().click(_.bind(self.editCustomTrack, self, n));
          $('<h3 class="name"/><p class="long-desc"/>').appendTo($d);
          // If track settings are to be applied, ensure any new custom tracks are added to them
          // This prevents new tracks from being added and then immediately hidden (confusing)
          // -- One exception! If self._nextDirectives contain at least one track name
          //    among the new tracks to be added, do not do this, we then assume they are overriding.
          if (browserDirectives.tracks && !nextDirectivesIncludeOneNewTrack) {
            if (!_.find(browserDirectives.tracks.split('|'), function(v) { return v.split(':')[0] == n; })) {
              browserDirectives.tracks += '|' + n;
            }
          }
        } else { $d = $ul.find('[name='+n+']').parent().children('.desc'); }
        if (url) { t.url = url; }
        // TODO: if the track is not new, inform that its data was replaced with the new track information
        self.availTracks[n] = {
          fh: {"0.1": {dense: t.heights.start}},
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
        // TODO (maybe): other browser directives at http://genome.ucsc.edu/goldenPath/help/hgTracksHelp.html#lines
        if (_.keys(browserDirectives).length) { self._initFromParams(browserDirectives); }
      }});
    },

    // Opens a dialog to edit the options for a custom track.
    editCustomTrack: function(n) {
      var self = this,
        o = self.options,
        $dialog = $(o.dialogs[0]).closest('.ui-dialog'),
        $customChks = $(self.options.trackPicker[3]).children('ul').find(':checkbox'),
        customTrackNames = $customChks.map(function() { return $(this).attr('name'); }),
        genomeSuppliedTrack = !_.contains(customTrackNames, n),
        trk = self.availTracks[n];

      self._initCustomTrackDialog(genomeSuppliedTrack);
      trk.custom.loadOpts($dialog, genomeSuppliedTrack);
      $dialog.data('track', trk);
      $dialog.trigger('open');
    },

    // Removes a custom tracks.
    _removeCustomTrack: function(tname) {
      var self = this,
        $li = $(self.options.trackPicker[3]).find('input[name="'+tname+'"]').closest('li'),
        url = self.availTracks[tname].custom.url;
      delete self.availTracks[tname];
      $li.remove();
      // Remove url from list of loaded URLs if there are no other tracks that were loaded from it
      if (url && !_.find(self.availTracks, function(trk) { return trk.custom && trk.custom.url == url; })) {
        self._customTrackUrls.loaded = _.difference(self._customTrackUrls.loaded, [url]);
      }
      self._fixTracks();
    },

    // Removes all custom tracks.
    _resetCustomTracks: function() {
      var self = this,
        $lis = $(self.options.trackPicker[3]).children('ul').children();
      $lis.find(':checkbox').each(function() { delete self.availTracks[$(this).attr('name')]; });
      $lis.remove();
      self._customTrackUrls.loaded = [];
      self._fixTracks();
    },

    // Sets a "lock" flag on a track that locks its display to a particular density. See the "eye lock" sidebar buttons
    lockDensity: function(track, density) {
      var self = this,
        o = self.options,
        $tracks = self.element.find('.browser-track-'+track),
        trk = _.find(o.tracks, function(t) { return t.n === track; });
      if (_.isUndefined(track)) { throw "Must specify track when calling lockDensity!"; }
      trk.lock = density;
      $tracks.genotrack('updateLockPackBtn', density === "pack");
      self.densityOrder(track, trk.h, $tracks.genotrack('bppps'), true);
    },

    // Determine for a given track and height what density is optimal for display.
    // For most scenarios a cached calculation is *RETURNED* (when ONLY the first argument is filled).
    // Whenever new tile data arrives or the user zooms, the cached order is UPDATED (when more arguments are provided).
    //   - In this scenario, the relevant genotracks are notified via their updateDensity() method.
    //   - There is no expected return value if `height`, `bppps`, or `force` are provided (the actions are asynchronous)
    densityOrder: function(track, height, bppps, force) {
      // If either `height` or `bppps` are not specified, provide the cached order for the given `track`
      if (_.isUndefined(height) || _.isUndefined(bppps)) { return this._densityOrder[track] || null; }
      
      var self = this,
        o = self.options,
        $elem = self.element,
        t = _.find(o.tracks, function(t) { return t.n === track; }),
        base = _.find(t.s, function(v) { return !_.isArray(v); }),
        fixedHeights = t.fh[bppps.topFormatted] || (_.keys(t.fh).length && t.fh[_.last(_.keys(t.fh))]) || {},
        baseHeight = fixedHeights[base] || 15,
        orderFor = height + "|" + bppps.topFormatted,
        prevOrder = self._densityOrder[t.n],
        prevOrderFor = self._densityOrderFor[t.n],
        $unrenderedCustom = $('.browser-track-'+t.n+' canvas.tdata.unrendered:not(.dens-dense)'),
        forceAt = {}, //{pack: [200, -2], full: [200, -3]},  // This is causing too much thrashing with heavy custom tracks
        order = {}, heights = [], i = 0, optimum;
      
      // All custom track tiles should be rendered before considering a new densityOrder; if not, defer the calculation
      if ($unrenderedCustom.length) {
        return $unrenderedCustom.trigger('render', _.after($unrenderedCustom.length, function() {
          self.densityOrder(track, height, bppps, force);
        }));
      }
      // If this is a repeat request to update the densityOrder at the same height+bppps, there is no need to proceed.
      if (prevOrderFor && prevOrderFor == orderFor && !force) { return; }
      
      // Always show the base density (typically, "dense") when within 3px of the baseHeight (the initial height)
      if (height <= baseHeight + 3) {
        order[base] = 0;
        _.each(t.s, function(d) { if (_.isArray(d)) { order[d[0]] = ++i; } });
      } else {
        // Otherwise, order the densities by their tiles' max height's proximity to the track height
        // with a 3x bias toward showing the taller density
        _.each(t.s, function(d) {
          if (_.isArray(d)) { d = d[0]; }
          if (fixedHeights[d]) { return heights.push([d, fixedHeights[d]]); }
          var $tdata = $('.browser-track-'+t.n+'>.bppp-'+classFriendly(bppps.top)+'>div>.tdata.dens-'+d);
          if ($tdata.find('.loading').length > 0) { orderFor = null; }
          var tdataHeights = $tdata.map(function() {
            return this.tagName == 'CANVAS' ? this.unscaledHeight() : (this.naturalHeight || this.height);
          }).get();
          var maxH = Math.max.apply(Math, tdataHeights);
          var minH = Math.min.apply(Math, tdataHeights);
          // If the user "locks" display at a density, we force that density's height to be optimal
          if (d != base && minH > 0 && t.lock === d) { maxH = height; }
          heights.push([d, maxH, minH]);
        });
        heights = _.map(heights, function(v, j) {
          var deltaY;
          v[2] = v[2] === 0;
          v[1] = v[2] ? 1000000 : v[1];      // effectively, never show 0 height tiles.
                                             // 0 height tiles are a special condition indicating the tile couldn't
                                             // be drawn. See js/custom/track-types/README.md.
          deltaY = height - v[1];
          // The following line is where the 3x bias toward the taller density is incorporated
          v[1] = (forceAt[v[0]] && height > forceAt[v[0]][0]) ? forceAt[v[0]][1] : (deltaY > 0 ? deltaY * 3 : -deltaY);
          v[1] -= j * 0.1;                   // marginally prioritize more detailed tracks, in the event of ties
          return v;
        });
        heights.sort(function(a, b){ return a[1] - b[1]; });
        _.each(heights, function(v) { order[v[0]] = ++i; });
        // Unless all of the other densities were 0 height tiles, make the base density last priority.
        if (heights.length - _.compact(_.pluck(heights, '2')).length > 1) { order[base] = ++i; }
      }
      self._densityOrder[t.n] = order;
      self._densityOrderFor[t.n] = orderFor;
      if (prevOrder && !_.isEqual(order, prevOrder)) {
        $elem.find('.browser-track-'+t.n).genotrack('updateDensity');
      }
    },

    // Sorts tracks for a track picker based on their title and then the .srt attribute
    _sortedTracks: function(tracks) {
      var d = this.options.trackDesc;
      return _.sortBy(_.sortBy(tracks, function(t) { return d[t.n].sm || t.n; }), 'srt');
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
    // `forceful` is a boolean indicating whether a search should still be initiated even if the query hasn't changed
    normalizePos: function(pos, forceful) {
      var o = this.options,
        ret = {},
        matches, end;

      ret.pos = $.trim(_.isUndefined(pos) ? $(o.jump[0]).val() : pos);
      if (ret.pos === '') { this._searchFor(''); return null; }

      matches = ret.pos.match(/^([a-z]+[^:]*)(:(-?\d+)(([-@])(\d+(\.\d+)?))?)?/i);
      // Does the position string have a colon in it? If so, we try to parse it as a bp position
      if (matches && matches[2]) {
        var chr = _.find(o.chrLabels, function(v) { return v.n === matches[1]; });
        // If this didn't match a real chromosome name, use the first, by default.
        if (!chr) { chr = _.first(o.chrLabels); }
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
      } else {
        pos = parseInt(ret.pos, 10);
        if (_.isNaN(pos)) {
          this._searchFor(ret.pos, forceful);
          return null;
        }
        ret.pos = pos;
      }

      return ret;
    },

    // Displays the search dropdown where the user can select from features that match the query
    // `forceful` is a boolean indicating whether a search should still be initiated even if the query hasn't changed
    _searchFor: function(search, forceful) {
      var self = this,
        o = self.options,
        $elem = self.element,
        highPriorityTracks, alwaysSearchableTracks, searchableVisibleTracks, searchTargets, loadAllChoicesAfter;

      function hilite(text, searchFor) {
        function replacer(m) { return '<span class="hilite">'+m+'</span>'; }
        return text.replace(new RegExp(regExpQuote(searchFor), "gi"), replacer);
      }

      function createChoice(c, cat) {
        var $c = $('<div class="choice"/>'),
          $h3 = $('<h3 class="name"/>').html(hilite(c.name, search)).appendTo($c);
        if (c.altName) { $('<span class="alt-name">').html(hilite(c.altName, search)).appendTo($h3); }
        $('<p class="long-desc"/>').html(hilite(c.desc, search)).appendTo($c);
        $c.bind('fakefocus', function() { $(this).addClass('focus'); $(this).siblings().removeClass('focus'); });
        $c.bind('fakeblur', function() { $(this).removeClass('focus'); });
        $c.mouseover(function() { $(this).trigger('fakefocus'); });
        $c.bind('click', {choice: c, cat: cat, self: self}, _.bind(self._searchChoiceClicked, self));
        return $c;
      }

      function hideChoices() { self.$choices.find('.choice').trigger('fakeblur'); self.$choices.hide(); }

      function loadAllChoices() {
        var choiceData = self._searchResults.data,
          jumpNow = _.first(_.compact(_.pluck(choiceData, 'goto'))),
          categories = _.extend.apply({}, _.compact(_.pluck(choiceData, 'categories'))),
          catnames, choicesPerCategory;
        categories = _.pick(categories, function(cat) { return cat.choices.length > 0; });

        self.$choices.removeClass('loading');
        if (jumpNow) { self.jumpTo(jumpNow); return; }

        catnames = _.keys(categories);
        if (!categories || catnames.length === 0) { self.$choices.addClass('no-results'); return; }
        catnames = _.sortBy(catnames, function(catname) {
          var trk = self.availTracks[categories[catname].track];
          return trk.custom && trk.custom.opts.priority <= 1 ? 0 : 1;
        });
        choicesPerCategory = Math.max(Math.ceil(12 / catnames.length), 3);

        _.each(catnames, function(catname) {
          var cat = categories[catname];
          $('<div class="category-header"/>').text(catname).appendTo(self.$choices);
          _.each(cat.choices.slice(0, choicesPerCategory), function(c) {
            createChoice(c, cat).appendTo(self.$choices);
          });
        });
        self.$choices.find('.choice').eq(0).trigger('fakefocus');
      }

      if (search === '') { self.prevSearch = ''; return hideChoices(); }
      if (search === self.prevSearch && !forceful) { return; }
      self.$choices.empty().addClass('loading').removeClass('no-results').slideDown();
      $('body').bind('mousedown.search', function(e) {
        if (!$(e.target).closest(self.$choices).length) { hideChoices(); }
        $('body').unbind('mousedown.search');
      });
      if (self.currentSearches) {
        _.each(self.currentSearches, function(s) { _.isFunction(s.abort) && s.abort(); });
      }
      self._searchId += 1;
      self.currentSearches = [];
      self._searchResults = {id: self._searchId, data: []};
      self.prevSearch = search;

      highPriorityTracks = _.filter(o.availTracks, function(t) { return t.custom && t.custom.opts.priority <= 1; });
      alwaysSearchableTracks = _.filter(highPriorityTracks, function(t) { return t.custom.isSearchable; });
      searchableVisibleTracks = _.filter(o.tracks, function(t) { 
        // Limit searchable tracks to those in the UCSC tracks cache as they can be done locally (i.e. are tolerably fast)
        return t.custom && t.custom.isSearchable && (!t.custom.bigDataUrl || (/^cache:\/\//).test(t.custom.bigDataUrl)); 
      });
      searchTargets = alwaysSearchableTracks.concat(searchableVisibleTracks);
      loadAllChoicesAfter = _.after(searchTargets.length + (o.custom ? 0 : 1), loadAllChoices);

      _.each(searchTargets, function(t) {
        t.custom.searchAsync(search, _.partial(function(searchId, data) {
          var reformattedData = {goto: data.goto, categories: {}};
          if (self._searchResults.id != searchId) { return; }  // too late
          reformattedData.categories[o.trackDesc[t.n].sm] = {
            track: t.n,
            choices: data.choices
          };
          self._searchResults.data.push(reformattedData);
          loadAllChoicesAfter();
        }, self._searchId));
      });
    },

    // Handles the selection of a search result from the search dropdown
    _searchChoiceClicked: function(e) {
      var self = this,
        $elem = self.element,
        c = e.data.choice,
        cat = e.data.cat,
        m = c.desc.match(/^\((.+)\)/),
        picked = m ? m[1].toLowerCase() : c.name.toLowerCase();

      $('body').unbind('mousedown.search');
      self.$trackPicker.find('input[name='+cat.track+']').attr('checked', true);
      self.tileFixingEnabled(false);

      self._fixTracks({duration: 0, complete: function() {
        // This callback maximizes the track that contained the feature clicked, and flashes the feature.
        // Flashing the clicked feature is tricky because everything is loading at different times.
        var $maximizeTrack = self.$lines.eq(self.centralLine).find('.browser-track-'+cat.track).eq(0);

        $maximizeTrack.one('trackload', function(e, bppps) {
          var $tdata = self.$lines.find('.browser-track-'+cat.track+' .bppp-'+classFriendly(bppps.top)+' .tdata.dens-pack'),
            maxHeight = 5 + Math.max.apply(Math, $tdata.map(function() { return this.naturalHeight || this.height; }).get());

          // After the track is resized, flash all the features that were added to our todo-list
          self._resizeTrack(cat.track, maxHeight, self.centralLine, function() {
            var $stillLoading = self.$lines.find('.browser-track-'+cat.track).has('.areas-loading');
            $elem.find('.browser-track').genotrack('updateDensity');
            function flash() { self.areaHover([cat.track, bppps.top, "pack", "name", picked], "FLASHME"); }
            // FIXME: this is pretty rickety
            if (!$stillLoading.length) { flash(); }
            else { $stillLoading.one('areaload', _.after($stillLoading.length, flash)); }
          });

        });

        _.defer(function(){
          self.tileFixingEnabled(true);
          $elem.find('.browser-track-'+cat.track).genotrack('fixClickAreas');
        });
      }});

      self.jumpTo(c.pos);
      return false;
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
      var now = (new Date()).getTime();
      this._pos(pos, null, true);
      this._updateReticle(centeredOn);
    },

    // If "to" is boolean, true will raise the slider one step and false will lower it one step.
    _animateZoom: function(to, duration) {
      var self = this,
        $slider = $(self.options.zoomSlider),
        from = $slider.slider('value');
      if (_.isBoolean(to)) { to = Math[to ? 'ceil' : 'floor'](from + (to ? 0.001 : -0.001)); }
      $slider.css('text-indent', 0).animate({textIndent: 1}, {
        queue: false,
        step: function(i) { $slider.slider('value', (to - from) * i + from); },
        complete: function() { self.bounceCheck(); },
        duration: duration || 150
      });
    },

    // Bounce off edges if we are toward the margins of the genome.
    // Can optionally specify an initial velocity (if the genome is currently moving) in px/ms
    bounceCheck: function(vInit) {
      var self = this,
        o = self.options,
        $elem = self.element,
        bpWidth = this.bpWidth(),
        pos = self.pos,
        numLines = self.lines().length,
        margins = [(-numLines + o.bounceMargin) * bpWidth, o.genomeSize - o.bounceMargin * bpWidth],
        outsideGenomeRange = pos < margins[0] || pos > margins[1];

      if (outsideGenomeRange) {
        // Stop any current inertial scrolling
        self.$lines.genoline('stopThrow');
        // Any line can perform the bounce animation, it doesn't really matter which one...
        self.$lines.eq(0).genoline('startBounce', vInit || 0);
      }
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
      var lineIndex = this.$lines.length == 1 ? 0 : this.$lines.index($src),
        pos = linePos - lineIndex * this.bpWidth();
      var now = (new Date()).getTime();
      this._pos(pos, $src);
    },

    // Handle a track resize event on one of the lines, propagating its changes to the other lines and fixing the layout
    recvTrackResize: function($src, name, height, callback) {
      var holdSteady = $src && this.$lines.index($src);
      this._resizeTrack(name, height, holdSteady, _.isFunction(callback) ? callback : true);
      this._saveParamsDebounced();
    },

    // Handle a track reorder action on one of the lines, propagating its changes to the other lines
    // newOrder is an array mapping oldIndex => newIndex
    recvSort: function($src, newOrder) {
      var o = this.options;
      _.each(o.tracks, function(v, i) { v._i = i; });
      o.tracks.sort(function(a, b) { return newOrder[a._i] - newOrder[b._i]; });
      _.each(o.tracks, function(v, i) { delete v._i; });
      this.$lines.not($src).genoline('fixTracks').genoline('fixTrackTiles');
      this._saveParamsDebounced();
    },

    // Handle a mousewheel event on one of the lines, propagating its changes to all lines.
    _recvZoom: function(e, manualDelta) {
      var self = this,
        o = this.options,
        d = [manualDelta, e.originalEvent.deltaY, e.originalEvent.wheelDeltaY, 
          e.originalEvent.wheelDelta, e.originalEvent.axis == 2 && -e.originalEvent.detail],
        userAgent = navigator && navigator.userAgent,
        // Adjustments must be applied to the "wheel" deltaY since every browser uses a different scale;
        // see https://github.com/facebookarchive/fixed-data-table/blob/master/src/vendor_upstream/dom/normalizeWheel.js
        wheelEventAdjust = [[(/firefox/i), 60]],
        value, delta, deltaMode;

      // You can scroll the track pickers, select boxes, and textareas as usual
      if ($(e.target).closest('.picker,select,textarea,.ui-dialog').length) { return; }

      self.$lines.genoline('stopThrow');                                // Stop any current inertial throwing animation
      if (_.isUndefined(self._wheelDelta)) { self._wheelDelta = 0; }
      $.tipTip.hide();                                                  // Hide any tipTips showing
      d = _.reject(d, _.isUndefined).shift();
      self.centeredOn = self._posAtMouse(e.originalEvent);

      if (d && self.centeredOn !== null) {
        value = self.$slider.slider('value');
        delta = (o.snapZoom ? (self._wheelDelta += d) : d) / 20;
        deltaMode = e.originalEvent.deltaMode;
        delta *= -(deltaMode === 0 ? 0.09 : (deltaMode === 1 ? 0.006: 0.001));
        _.find(wheelEventAdjust, function(v) { return v[0].test(userAgent) && (delta *= v[1]); });
        if (o.snapZoom) {
          if (Math.abs(delta) > 1.2) {
            self._animateZoom(delta > 0, 1000);
            self._wheelDelta = 0;
          }
        } else { self.$slider.slider('value', value + delta); }
        self._finishZoomDebounced(delta > 0);
      }
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
      this.bounceCheck();
      if (this.options.snapZoomAfter && !this.options.snapZoom) { this._animateZoom(direction); }
      if (this.options.snapZoom) { this._wheelDelta = 0; }
      this.lines().genoline('toggleZoomShield', false);
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
        if (t.custom) { $elem.find('.browser-track-'+t.n).genotrack('redrawAreaLabels'); }
        if (t.n === 'ruler') { $elem.find('.browser-track-'+t.n).genotrack('redrawRulerCanvasTicksAndBands'); }
      });
    },

    // Remembers the general layout & position of the browser for the next time it is opened
    // NOTE: This is _.debounce'd in _init()
    _saveParamsDebounced: function() {
      var self = this,
        pos = self.pos,
        o = self.options,
        rd = self._reticDelta(),
        chrMaybe = self.chrAt(pos + rd),
        chr = chrMaybe ? (chrMaybe.end ? o.chrLabels.slice(-2,-1)[0] : chrMaybe) : o.chrLabels[0],
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
        var now = (new Date()).getTime(),
          historyFn = now - (self._histLastReplaced || 0) > 20000 ? 'pushState' : 'replaceState';
        window.history[historyFn]({}, window.document.title, url);
        self._histLastReplaced = (new Date()).getTime();
      }
      $url.val(window.location.href.replace(/\?.*$/, '') + url);

      // Also make a URL to the equivalent view in UCSC
      if (!o.custom || (/^ucsc:/).test(o.genome)) {
        start = Math.max(Math.round(pos - chr.p), 1);
        end = Math.min(Math.round(pos - chr.p + self.bpWidth() * self.$lines.length), o.chrLengths[chr.n]);
        ucscParams = {db: o.genome.replace(/^ucsc:|:\d+$/g, ''), position: chr.n + ':' + start + '-' + end};
        _.each(o.tracks, function(t) {
          var densityOrderAsArray = _.map(self.densityOrder(t.n), function(v,k) { return [k,v]; }),
            topDensity = _.min(densityOrderAsArray, function(p) { return p[1]; });
          if (topDensity) { ucscParams[t.n] = topDensity[0]; }
        });
        $ucscLink.closest('.form-line').show();
        $ucscLink.attr('href', o.ucscURL + '?' + $.param(ucscParams));
      } else {
        $ucscLink.closest('.form-line').hide();
      }

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
        if (!areaIndices[k]) { console.log(k); areaIndices = false; break; }
        areaIndices = areaIndices[k];
      }
      if (areaIndices) {
        _.each(areaIndices, function(localAreaIds, tileId) {
          var $t = $('#'+tileId),
            $tdata = $t.children().children('.tdata.dens-'+keys[2]),
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
          $elem.find('.browser-track-' + keys[0] + '>.bppp-' + classFriendly(keys[1]) +
                     '>.dens-' + keys[2] + '.href-hash-' + keys[4]).addClass('hover');
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
      if (!self._dnaCallbacks) { self._dnaCallbacks = []; }

      function loadedFromAjax(data, statusCode, jqXHR) {
        self._dna[jqXHR._s] = data.seq;
        checkCallbacks();
      }
      function ajaxLoadDNA(left, right) {
        var slots = emptyCacheSlots(left, right);
        _.each(slots, function(s) {
          var ajaxOptions = {
            data: {db: o.genome, left: s * chunkSize + 1, right: (s + 1) * chunkSize + 1},
            dataType: 'json',
            success: loadedFromAjax,
            beforeSend: function(jqXHR) { jqXHR._s = s; }
          };
          if (o.custom) {
            ajaxOptions.type = "POST";
            ajaxOptions.data.chr_order = JSON.stringify(o.chrOrder);
            ajaxOptions.data.chr_lengths = JSON.stringify(o.chrLengths);
          }
          $.ajax(o.ajaxDir + 'dna.php', ajaxOptions);
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

      var dna;
      if (o.custom && o.custom.canGetSequence) {
        o.custom.getSequence(left, right, function(dna) { callback(dna, extraData); });
        return;
      } else {
        dna = getFromCache(left, right);
      }
      if (dna !== null) { callback(dna, extraData); }
      else {
        self._dnaCallbacks.push({left: left, right: right, fn: callback, extraData: extraData});
        ajaxLoadDNA(Math.min(left, self.pos), Math.max(right, self.pos + self.bpWidth() * self.$lines.length));
      }
    },

    // Updates the text for the genome species and description in the window title and footer
    _updateGenomePicker: function() {
      var self = this,
        o = self.options,
        $genome = $(o.genomePicker[0]),
        $title = $genome.find('.title'),
        $desc = $genome.find('.description'),
        $li = $genome.find('li.divider').eq(0).show();

      self._defaultTitle = self._defaultTitle || window.document.title;
      window.document.title = o.species + ' - ' + self._defaultTitle;
      $title.text(o.species.replace(/\s+\(.*$/, '')).attr('title', o.species);
      $desc.text(o.assemblyDate || '(' + o.genome.replace(/\|.*$/, '') + ')');
      $desc.attr('title', o.assemblyDate);

      // Fill the genome picker with available configured genomes
      $genome.find('.choice.genome-choice').remove();
      _.each(o.genomes, function(v, k) {
        if (/^_/.test(k) || k == o.genome) { return; }
        var $a = $('<a class="clickable"/>').attr('href', './?db='+k),
          $newli = $('<li class="choice genome-choice"/>').insertBefore($li);
        $a.appendTo($newli);
        $('<span class="name"/>').text(v.species).appendTo($a);
        $('<span class="long-desc"/>').text(v.assemblyDate + ' (' + k + ')').appendTo($a);
        $a.hover(function() { $(this).addClass('hover'); }, function() { $(this).removeClass('hover'); });
      });
      if ($genome.find('.choice.genome-choice').length === 0) { $li.hide(); }
    },
    
    // Shows the dialog with warnings.
    showWarning: function(message, error) {
      var self = this,
        o = self.options,
        $warningsButton = $(o.warnings[0]),
        $messages = self.$warningsDialog.find('.messages > ol'),
        $oldMessages = $messages.children('li'),
        $li = $.mk('li').html(message),
        lineno = (error.lineno ? 'line ' + error.lineno + ' of ' : ''),
        context = error.context && ('In ' + lineno + error.context + ':'),
        stack = error.stack;
      
      if (context) {
        if (error.line) { $.mk('div').addClass('line mono').text(error.line).prependTo($li); }
        $.mk('div').addClass('context').text(context || stack).prependTo($li);
      }
      if (stack) { console.log(stack); }
      $.mk('div').addClass('num').text(($oldMessages.length + 1) + '.').prependTo($li);
      $li.appendTo($messages);
      self.$trackPicker.add(self.$customTracks).trigger('close');
      self.$warningsDialog.trigger('open');
      self.$warningsDialog.find('.messages').scrollTop($messages.get(0).scrollHeight);
      $warningsButton.fadeIn(400).fadeOut(400).fadeIn(400).fadeOut(400).fadeIn(400);
    }

  });

};
