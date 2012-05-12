// Creates a table of contents for <h2/> .. <h6/> and inserts it before the first <h2/>
$(function() {
  
  function generateID(text) {
    var inc = 0;
    text = text.toString().toLowerCase().replace(/[^_a-zA-Z0-9-]/g, '-');
    while($('#' + text + (inc ? '-' + inc : '')).length) { inc++; }
    return text + (inc ? '-' + inc : '')
  }
  
  function generateTOC(selector) {
    var $toc = $('<div class="toc"/>'), prevLevel = 2, nums = [0,0,0,0,0], $ul, $li;
    $('<h2>Table of Contents</h2>').appendTo($toc);
    $ul = $('<ul></ul>').appendTo($toc);
    $(selector || 'body').find('h2,h3,h4,h5,h6').each(function() {
      var $h = $(this),
        text = $h.text(),
        level = parseInt($h.get(0).tagName.replace(/^h/i, ''), 10),
        $a = $('<a></a>');
      if (!$h.attr('id')) { $h.attr('id', generateID(text)); }
      $a.attr('href', '#' + $h.attr('id'));
      if (level > prevLevel) {
        for (var l = prevLevel; l < level; l++) { $ul = $('<ul></ul>').appendTo($li); }
      } else if (level < prevLevel) {
        for (var l = prevLevel; l > level; l--) { $ul = $ul.parent().closest('ul'); }
      }
      for (var l = level - 1; l < nums.length; l++) { nums[l] = 0; }
      nums[level - 2]++;
      $li = $('<li></li>').appendTo($ul);
      $li.append($a.text(nums.slice(0, level - 1).join('.') + ' ' + text));
      prevLevel = level;
    });
    return $toc;
  }
  
  $('#toc-wrapper').append(generateTOC());
});