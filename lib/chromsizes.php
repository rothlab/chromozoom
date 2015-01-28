<?php

/* Utility functions for working with chrom.sizes files
 *
 *
 */

define("IMPORTANT_CHROMS_PATTERN", '/^chr(?!Un)/');
global $looks_roman;

function processLine($line, &$chrom_sizes) {
  $fields = array_slice(explode("\t", $line), 0, 2);
  if ($fields[0] != '') {
    $chrom_sizes[$fields[0]] = $fields[1];
    if (preg_match(IMPORTANT_CHROMS_PATTERN, $fields[0])) { return $fields[0]; }
  }
  return FALSE;
}

function implodeOnTabs($row) { return implode("\t", $row); }

function romanToInt($roman) {
  $romans = array('M' => 1000, 'CM' => 900, 'D' => 500, 'CD' => 400, 'C' => 100, 'XC' => 90, 'L' => 50, 
      'XL' => 40, 'X' => 10, 'IX' => 9, 'V' => 5, 'IV' => 4, 'I' => 1);
  $result = 0;
  
  foreach ($romans as $key => $value) {
    while (strpos($roman, $key) === 0) {
      $result += $value;
      $roman = substr($roman, strlen($key));
    }
  }
  return $result;
}

function looksRomanToMe($chrs) {
  global $looks_roman;
  foreach($chrs as $chr) {
    $roman_chrs += romanToInt(preg_replace(IMPORTANT_CHROMS_PATTERN, '', $chr)) > 0 ? 1 : 0;
  }
  $looks_roman = $roman_chrs > count($chrs) * 0.8;
}

// Compare with UCSCClient#chr_sort in lib/ucsc_stitch.rb
function chrSort($rowA, $rowB) {
  global $looks_roman;
  list($chrA, $sizeA) = $rowA;
  list($chrB, $sizeB) = $rowB;
  $chrA_is_important = preg_match(IMPORTANT_CHROMS_PATTERN, $chrA);
  $chrB_is_important = preg_match(IMPORTANT_CHROMS_PATTERN, $chrB);
  
  // important chroms always win
  if ($chrA_is_important && !$chrB_is_important) { return -1; }
  if (!$chrA_is_important && $chrB_is_important) { return 1; }
  
  // if both are important, sort by the number of the chromosome (can be roman)
  if ($chrA_is_important && $chrB_is_important) {
    $chrA = preg_replace(IMPORTANT_CHROMS_PATTERN, '', $chrA);
    $chrB = preg_replace(IMPORTANT_CHROMS_PATTERN, '', $chrB);
    if (isset($looks_roman) && $looks_roman) {
      $sizeA = -romanToInt($chrA);
      $sizeB = -romanToInt($chrB);
    } else {
      // if the chromosome doesn't have a number (e.g., chrM or chrX)
      // we put it at the end and sort by the ASCII value of this character
      if (preg_match('/^\\d+(\\.\\d+)?(\w+)?/', $chrA, $matches)) { 
        $sizeA = -floatval($chrA);
        if (strlen($matches[2]) > 0) { $sizeA -= 0.5; }
      } else { $sizeA = -1e7 - ord($chrA); }
      if (preg_match('/^\\d+(\\.\\d+)?(\w+)?/', $chrB, $matches)) { 
        $sizeB = -floatval($chrB);
        if (strlen($matches[2]) > 0) { $sizeB -= 0.5; }
      } else { $sizeB = -1e7 - ord($chrB); }
    }
  }
  
  // sizes get sorted in reverse
  if ($sizeA == $sizeB) { return 0; }
  return $sizeA < $sizeB ? 1 : -1;
}