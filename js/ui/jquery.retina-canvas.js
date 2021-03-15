/*
 * This module enhances HTMLCanvasElement and OffscreenCanvas to permit easier usage on Retina screens.
 *
 * It is similar to the approach used in https://github.com/jondavidjohn/hidpi-canvas-polyfill
 * except please note that webkitBackingStorePixelRatio is now deprecated in Safari:
 * https://developer.apple.com/library/content/releasenotes/General/WhatsNewInSafari/Articles/Safari_7_0.html#//apple_ref/doc/uid/TP40014305-CH5-SW18
 * and therefore we should mostly be looking at window.devicePixelRatio as to what our true ratio
 * between CSS pixels and device pixels is.
 *
 * In general, we want to operate in CSS pixels since that's the unit used by other code in chromozoom.
 * 
 * Here we provide a helper to calculate and cache the CSS to device pixel ratio on the <canvas> element,
 * setters and getters for the canvas height and width that use CSS pixels instead of canvas pixels,
 * and a wrapped .getContext('2d') method that automatically .scale()'s the context if the pixel ratio > 1.
 * We also add a $.fn.canvasAttr() jQuery method that simplifies access to height/width from jQuery.
 */

module.exports = function(global, jQuery) {
  
  var globalCanvasPixelRatio = -1;

  function enhanceCanvasPrototype(CanvasElem, $) {
  
    var prototype = CanvasElem.prototype,
      _superGetContext = prototype.getContext;
  
    // A helper to calculate and cache the CSS to device pixel ratio for the <canvas> element
    // Note: this is calculated only once, even if the window is moved to a different display.
    prototype.calculateRatio = function(context) {
      var ratio = this._ratio,
        backingStore, context;
    
      if (ratio) { return ratio; }
      
      if (globalCanvasPixelRatio == -1) {
        context = context || _superGetContext.call($('<canvas/>').get(0), '2d');
    
        backingStore = context.backingStorePixelRatio ||
              context.webkitBackingStorePixelRatio ||
              context.mozBackingStorePixelRatio ||
              context.msBackingStorePixelRatio ||
              context.oBackingStorePixelRatio || 1;
    
        ratio = globalCanvasPixelRatio = (global.devicePixelRatio || 1) / backingStore;
      } else {
        ratio = globalCanvasPixelRatio;
      }

      return this._ratio = ratio;
    };
  
    // Sets or returns the height of the canvas in CSS pixels.
    prototype.unscaledHeight = function(height) {
      var ratio = this.calculateRatio();
      // We can set shadow props `this._height` and `this._width` on a <canvas> to pretend it has different dimensions
      // This is useful when we've delegated drawing to an OffscreenCanvas which has changed the underlying dimensions
      if (typeof(height) == 'undefined') { 
        return (typeof(this._height) == 'undefined' ? this.height : this._height) / ratio; 
      } else {
        // anytime you change canvas dimensions, the drawing context resets
        this._currentScale = 1;
        this.height = height * ratio;
        return height;
      }
    };
    
    // Sets or returns the width of the canvas in CSS pixels.
    prototype.unscaledWidth = function(width) {
      var ratio = this.calculateRatio();
      // We can set shadow props `this._height` and `this._width` on a <canvas> to pretend it has different dimensions
      // This is useful when we've delegated drawing to an OffscreenCanvas which has changed the underlying dimensions
      if (typeof(width) == 'undefined') { 
        return (typeof(this._width) == 'undefined' ? this.width : this._width) / ratio; 
      } else {
        // anytime you change canvas dimensions, the drawing context resets
        this._currentScale = 1;
        this.width = width * ratio;
        return width;
      }
    };
  
    // A wrapper for the native method that automatically .scale()'s the context if the pixel ratio > 1.
    prototype.getContext = function(type) {
      var backingStore, ratio, currentScale,
        context = _superGetContext.call(this, type),
        currentScale = this._currentScale || 1;

      if (type === '2d') {
        ratio = this.calculateRatio(context);

        if (ratio / currentScale > 1) { 
          context.scale(ratio / currentScale, ratio / currentScale);
          this._currentScale = ratio;
        }
      }

      return context;
    };
  
  };
  
  if (global.HTMLCanvasElement) { enhanceCanvasPrototype(global.HTMLCanvasElement, jQuery); }
  if (global.OffscreenCanvas) { enhanceCanvasPrototype(global.OffscreenCanvas, jQuery); }  
  
  (function($) {
    
    // Shim for setters where it will pass height and width to unscaledHeight and unscaledWidth above.
    //
    // We create a new function instead of shimming $.fn.attr to avoid a massive performance penalty, 
    // as $.fn.attr is used all over jQuery code and it is rarely interacting with <canvas> elements
    
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