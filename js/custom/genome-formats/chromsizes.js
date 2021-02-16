// ====================================================================
// = chrom.sizes format: http://www.broadinstitute.org/igv/chromSizes =
// ====================================================================
// 
// Note: we are extending the general use of this to also include either:
//   1) data loaded from the genome.txt and annots.xml iles of an IGB quickload directory, OR
//   2) metadata loaded from the UCSC MySQL database about a particular UCSC genome.

var utils = require('./utils/utils.js'),
  parseInt10 = utils.parseInt10,
  strip = utils.strip,
  optsAsTrackLine = utils.optsAsTrackLine
  trackHeightForType = utils.trackHeightForType;

var ChromSizesFormat = {
  init: function() {
    var self = this,
      m = self.metadata,
      o = self.opts;
    o.species = m.species || 'Custom Genome';
    o.assemblyDate = m.assemblyDate || '';
    
    if (m.tracks) { self.format().createTracks(m.tracks); }
    if (_.isArray(m.categories)) { o.groupTracksByCategories = m.categories; }
    o.searchableTracks = m.moreTracks || (m.tracks && m.tracks.length > 15);
    self.canSearchTracks = _.isString(m.moreTracks);
    
    if (m.cytoBandIdeo) { self.format().createChrBands(m.cytoBandIdeo); }
  },
  
  createTracks: function(tracks) {
    var self = this,
      o = self.opts,
      categories = {};
      
    _.each(tracks, function(t) {
      self.format()._convertTrackToOpts.call(self, t, o, true);
      categories[o.trackDesc[t.name].cat] = true;
    });
    
    if (!o.groupTracksByCategories && _.keys(categories).length > 1) { o.groupTracksByCategories = true; }
  },
  
  _convertTrackToOpts: function(t, o, hideAllChildren) {
    var visible = true,
      cat = t.grp || "Feature Tracks",
      trackOpts, container, trackSpec, tagging;
    
    t.lines = t.lines || [];
    trackOpts = /^track\s+/i.test(t.lines[0]) ? global.CustomTracks.parseDeclarationLine(t.lines.shift()) : {};
    _.extend(trackOpts, t.opts, {name: t.name, type: t.type});
    if ((hideAllChildren && t.parent) || trackOpts.visibility == 'hide') { visible = false; }
    delete trackOpts.visibility;
  
    trackSpec = {n: t.name};
    if (t.parent) { trackSpec.parent = t.parent; }
    if (t.srt) { trackSpec.srt = t.srt; }
  
    if (t.composite) {
      container = trackOpts.container && trackOpts.container == 'multiWig' ? 'multiWig' : 'composite';
      tagging = trackOpts.tagging;
      delete trackOpts.container;
      delete trackOpts.tagging;
    
      _.extend(trackSpec, {
        c: container,
        opts: trackOpts,
        tagging: tagging
      });
      o.compositeTracks.push(trackSpec);
    } else {
      _.extend(trackSpec, {
        fh: {},
        s: ['dense', 'squish', 'pack'],
        h: trackHeightForType(t.type),
        m: ['pack'],
        customData: t.lines
      });
      if (trackOpts.tags) { trackSpec.tags = trackOpts.tags; }
      delete trackOpts.tags;
    
      t.lines.unshift('track ' + optsAsTrackLine(trackOpts) + '\n');
      o.availTracks.push(trackSpec);
      if (visible) { o.tracks.push({n: t.name}); }
    }
  
    o.trackDesc[t.name] = {
      cat: cat,
      sm: t.shortLabel || t.name,
      lg: t.description || t.name
    };
    
    return o;
  },
  
  createChrBands: function(cytoBandIdeo) {
    var o = this.opts;
    o.chrBands = _.compact(_.map(cytoBandIdeo.split("\n"), function(l) { 
      var fields = l.split("\t");
      if (fields.length != 5) { return false; }
      fields[1] = parseInt10(fields[1]);
      fields[2] = parseInt10(fields[2]);
      return fields;
    }));
    if (o.chrBands.length > 0) { 
      o.ideogramsAbove = true;
      o.availTracks[0].h = 50;
    }
  },
  
  parse: function(text) {
    var lines = text.split("\n"),
      o = this.opts;
    
    _.each(lines, function(line, i) {
      var chrsize = strip(line).split(/\s+/, 2),
        chr = chrsize[0],
        size = parseInt10(chrsize[1]);
      if (_.isNaN(size)) { return; }
      o.chrOrder.push(chr);
      o.chrLengths[chr] = size;
      o.genomeSize += size;
    });
    
    if (o.chrBands && o.chrBands.length > 0) {
      o.chrBands = _.filter(o.chrBands, function(v) { return !_.isUndefined(o.chrLengths[v[0]]); });
    }
  },
  
  searchTracks: function(params, callback) {
    var self = this,
      o = self.opts,
      successCallback;
    if (!_.isString(o.searchableTracks)) { callback([]); }
    
    successCallback = (function(params) {
      var sp = _.clone(params);
      return function(data) {
        if (data.error) { callback(data); }
        else {
          var opts = {compositeTracks: [], availTracks: [], tracks: [], trackDesc: {}, _searchParams: sp};
          _.each(data.tracks, function(t) { self.format()._convertTrackToOpts.call(self, t, opts, false); });
          callback(opts);
        }
      };
    })(params);
    
    $.ajax(o.searchableTracks, {
      data: params,
      success: successCallback
    });
  }
  
};

module.exports = ChromSizesFormat;