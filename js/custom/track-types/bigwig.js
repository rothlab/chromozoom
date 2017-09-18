

// =====================================================================
// = bigWig format: http://genome.ucsc.edu/goldenPath/help/bigWig.html =
// =====================================================================

var BigWigFormat = {
  defaults: {
    altColor: '128,128,128',
    priority: 100,
    autoScale: 'on',
    alwaysZero: 'off',
    gridDefault: 'off',
    maxHeightPixels: '128:128:15',
    graphType: 'bar',
    viewLimits: '',
    yLineMark: 0.0,
    yLineOnOff: 'off',
    windowingFunction: 'maximum',
    smoothingWindow: 'off'
  },
  
  // Magic bytes that identify this format
  magicBytes: [0x888FFC26, 0x26FC8F88],

  init: function() {
    if (!this.opts.bigDataUrl) {
      throw new Error("Required parameter bigDataUrl not found for bigWig track at " + JSON.stringify(this.opts) + (this.opts.lineNum + 1));
    }
    this.type('wiggle_0').initOpts.call(this);
  },
  
  _binFunctions: {'minimum':1, 'maximum':1, 'mean':1, 'min':1, 'max':1, 'std':1, 'coverage':1},
  
  applyOpts: function() { 
    this.type('wiggle_0').applyOpts.apply(this, arguments);
    // this.scales needs to be synched back to the DOM side so the $.ui.genotrack can update it
    this.syncProps(['opts', 'drawRange', 'scales']); // FIXME: Move to wiggle_0?
  },

  parse: function(lines) {
    var self = this;
    self.stretchHeight = true;
    self.range = self.isOn(self.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
    return true;
  },
  
  // The only gain of getting info on the bigWig file is that we can grab the range of the data and set this.scales.
  // But it's expensive to do this unless the track is going to be displayed, so this is deferred until .finishSetup().
  finishSetup: function() {
    var self = this;
    
    $.ajax(self.ajaxDir() + 'bigwig.php', {
      data: {info: 1, url: self.opts.bigDataUrl},
      async: false,  // This is alright since parsing normally happens in a Web Worker
      success: function(data) {
        var rows = data.split("\n");
        _.each(rows, function(r) {
          var keyval = r.split(': ');
          if (keyval[0]=='min') { self.range[0] = Math.min(parseFloat(keyval[1]), self.range[0]); }
          if (keyval[0]=='max') { self.range[1] = Math.max(parseFloat(keyval[1]), self.range[1]); }
        });
      }
    });
    self.type().applyOpts.apply(self);
  },

  prerender: function(start, end, density, precalc, callback) {
    var self = this,
      width = precalc.width,
      // Note: bigWig tools expect regions in 0-based, right-OPEN coordinates
      // (even though wiggle files use 1-based coordinates)
      range = self.chrRange(start, end, true).join(' '),
      ajaxParams = $.param({url: self.opts.bigDataUrl, width: width, winFunc: self.opts.windowingFunction});
  
    function success(data) {
      var drawSpec = self.type('wiggle_0').initDrawSpec.call(self, precalc),
        lines = data.split(/\s+/g);
      _.each(lines, function(line) {
        if (line == 'n/a') { drawSpec.bars.push(null); }
        else if (line.length) { drawSpec.bars.push((parseFloat(line) - self.drawRange[0]) / drawSpec.vScale); }
      });
      callback(drawSpec);
    }
  
    $.ajax(self.ajaxDir() + 'bigwig.php?' + ajaxParams, {
      type: range.length > 500 ? 'POST' : 'GET',
      data: { range: range },
      success: success
    });
  },

  render: function(canvas, start, end, density, callback) {
    var self = this,
      width = canvas.unscaledWidth(),
      ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { throw "Canvas not supported"; }
    self.prerender(start, end, density, {width: width}, function(drawSpec) {
      self.type('wiggle_0').drawBars.call(self, ctx, drawSpec, canvas.unscaledHeight(), width);
      _.isFunction(callback) && callback();
    });
  },

  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },

  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
};

module.exports = BigWigFormat;