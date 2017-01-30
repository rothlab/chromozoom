module.exports = function(global, jQuery) {

  (function(prototype, $) {
  
    var _superGetContext = prototype.getContext;
  
    prototype.calculateRatio = function(context) {
      var ratio = $(this).data('ratio'),
        backingStore, context;
    
      if (ratio) { return ratio; }
      context = context || _superGetContext.call(this, '2d');
    
      backingStore = context.backingStorePixelRatio ||
            context.webkitBackingStorePixelRatio ||
            context.mozBackingStorePixelRatio ||
            context.msBackingStorePixelRatio ||
            context.oBackingStorePixelRatio || 1;
    
      ratio = (global.devicePixelRatio || 1) / backingStore;
      $(this).data('ratio', ratio);
      return ratio;
    };
  
    prototype.unscaledHeight = function(height) {
      var ratio = this.calculateRatio();
      if (typeof(height) == 'undefined') { return this.height / ratio; }
      else {
        this.height = height * ratio;
        return height;
      }
    };
  
    prototype.unscaledWidth = function(width) {
      var ratio = this.calculateRatio();
      if (typeof(width) == 'undefined') { return this.width / ratio; }
      else {
        this.width = width * ratio;
        return width;
      }
    };
  
    prototype.getContext = function(type) {
      var backingStore, ratio, currentScale,
        context = _superGetContext.call(this, type),
        currentScale = $(this).data('currentScale') || 1;

      if (type === '2d') {
        ratio = this.calculateRatio(context);

        if (ratio / currentScale > 1) { 
          context.scale(ratio / currentScale, ratio / currentScale);
          $(this).data('currentScale', ratio);
        }
      }

      return context;
    };
  
  })(global.HTMLCanvasElement.prototype, jQuery);
  
  
  
  (function($) {
    
    // Shim for setters where it will pass height and width to unscaledHeight and unscaledWidth above.
    //
    // We create a new function instead of shimming $.fn.attr to avoid a massive performance penalty, 
    // as $.fn.attr is used everywhere in jQuery code and usually not on <canvas> elements
    
    $.fn.canvasAttr = function(attrs, val) {
      var name = attrs,
        elem;
      
      if (typeof val != 'undefined') {
        attrs = {};
        attrs[name] = val;
      }
      
      if (typeof attrs != 'object') {
        elem = this.get(0);
        if (elem.tagName === 'CANVAS') {
          if (name == 'height') { return elem.unscaledHeight(); }
          else if (name == 'width') { return elem.unscaledWidth(); }
          else return this.attr(name, val);
        } else { throw "You should only use $.fn.canvasAttr on <canvas> elements." }
      }
      
      this.each(function() {
        elem = this;
        if (elem.tagName === 'CANVAS') {
          jQuery.each(attrs, function(k, v) {
            if (k == 'height') { elem.unscaledHeight(v); }
            else if (k == 'width') { elem.unscaledWidth(v); }
            else { $(elem).attr(k, v); }
          });
        } else { throw "You should only use $.fn.canvasAttr on <canvas> elements." }
      });
      
      // allow chaining when used as a setter
      return this;
    }
    
  })(jQuery);
  
};