module.exports = function($) {
  // ==================================================================================
  // = The following are helper functions used widely throughout the rest of the code =
  // ==================================================================================
  
  utils = {};
  
  // Faster than Math.floor (http://webdood.com/?p=219)
  utils.floorHack = function(num) { return (num << 0) - (num < 0 ? 1 : 0); }
  
  // Pads a number with front-leading 0's to given length
  utils.pad = function(number, length) {
    var str = '' + number;
    while (str.length < length) { str = '0' + str; }
    return str;
  }

  // Turns an arbitrary string into something that can be used as an element's class
  utils.classFriendly = function(val) { return val.toString().replace(/[^_a-zA-Z0-9-]/g, '-'); }
  
  // Mostly for debugging; show the fps in the bottom-right corner of the browser
  utils.fps = function(a, b, c) {
    $('#fps').text(a + ' ' + utils.floorHack(1000/b) + ' ' + utils.floorHack(c*10)/10 + ' ' + $('#browser *').length);
  }
  
  // A simplistic hash function for quickly turning strings into numbers
  // Note that since the hash space is 2^32, collisions are practically guaranteed after 80k strings, 
  // and there's a 5% chance at 20k: http://betterexplained.com/articles/understanding-the-birthday-paradox/
  utils.shortHash = function(str) {
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
  utils.basename = function(path) { return path.replace(/^.*[\/\\]/g, ''); };
  
  // Decode characters that are safe within our query strings, for increased readability
  utils.decodeSafeOctets = function(query) {
    var safe = {'3A': ':', '40': '@', '7C': '|', '2F': '/'};
    return query.replace(/%([0-9A-F]{2})/gi, function(m, oct) { return safe[oct] || m; });
  }
  
  // Escape something so it can be inserted into a regular expression
  utils.regExpQuote = function(str) { return str.replace(/([.?*+^$[\]\\(){}-])/g, "\\$1"); };
  
  return utils;
  
};