// =========================================================================
// = bedGraph format: http://genome.ucsc.edu/goldenPath/help/bedgraph.html =
// =========================================================================

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10;

// Intended to be loaded into CustomTrack.types.bedgraph
var BedGraphFormat = {
  defaults: {
    altColor: '',
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

  init: function() { return this.type('wiggle_0').init.call(this); },
  
  _binFunctions: utils.wigBinFunctions,
  
  initOpts: function() { return this.type('wiggle_0').initOpts.call(this); },
  
  applyOpts: function() { return this.type('wiggle_0').applyOpts.apply(this, arguments); },
  
  parse: function(lines) {
    var self = this,
      genomeSize = this.browserOpts.genomeSize,
      data = {all: []},
      mode, modeOpts, chrPos, m;
    self.range = self.isOn(this.opts.alwaysZero) ? [0, 0] : [Infinity, -Infinity];
  
    _.each(lines, function(line, lineno) {
      var cols = ['chrom', 'chromStart', 'chromEnd', 'dataValue'],
        datum = {},
        chrPos, start, end, val;
      _.each(line.split(/\s+/), function(v, i) { datum[cols[i]] = v; });
      chrPos = self.browserOpts.chrPos[datum.chrom];
      if (_.isUndefined(chrPos)) {
        self.warn("Invalid chromosome at line " + (lineno + 1 + self.opts.lineNum));
      }
      start = parseInt10(datum.chromStart);
      end = parseInt10(datum.chromEnd);
      val = parseFloat(datum.dataValue);
      data.all.push({start: chrPos + start, end: chrPos + end, val: val});
    });

    return self.type('wiggle_0').finishParse.call(self, data);
  },
  
  initDrawSpec: function() { return this.type('wiggle_0').initDrawSpec.apply(this, arguments); },
  
  drawBars: function() { return this.type('wiggle_0').drawBars.apply(this, arguments); },

  prerender: function(start, end, density, precalc, callback) {
    return this.type('wiggle_0').prerender.call(this, start, end, density, precalc, callback);
  },

  render: function(canvas, start, end, density, callback) {
    this.type('wiggle_0').render.call(this, canvas, start, end, density, callback);
  },
  
  loadOpts: function() { return this.type('wiggle_0').loadOpts.apply(this, arguments); },
  
  saveOpts: function() { return this.type('wiggle_0').saveOpts.apply(this, arguments); }
  
};

module.exports = BedGraphFormat;