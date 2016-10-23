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

function guessIfRoman($chrs) {
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

// Fetches a chrom.sizes file from $chrom_info_url
// Sorts the contigs by "importance" and then contig length (see chrSort above)
function getTopChromSizes($chrom_info_url, $contig_limit) {
  $chrom_sizes = array();
  $rows = array();
  $important_chroms = array();
  
  $fp = @gzopen($chrom_info_url, 'rb');
  if ($fp === FALSE) {
    // Some chromInfo.txt's are not gzipped
    $fp = @gzopen(preg_replace('/.gz$/', '', $chrom_info_url), 'rb');
  }
  if ($fp === FALSE) { return FALSE; }
    
  // decompress the gzipped data into a temporary stream
  $temp_fp = fopen("php://temp", "w+");
  while(!gzeof($fp)) {
    fwrite($temp_fp, gzread($fp, 1048576));
  }
  gzclose($fp);
  rewind($temp_fp);
  
  $last_line = "";
  while (!feof($temp_fp)) {
    $chunk = $last_line . fread($temp_fp, 1048576); // want to read 1MB at a time
    $lines = explode("\n", $chunk);
    foreach($lines as $i => $line) {
      if ($i == count($lines) - 1) { $last_line = $line; continue; }
      else {
        $chr = processLine($line, $chrom_sizes);
        if ($chr !== FALSE) { $important_chroms[$chr] = TRUE; }
      }
    }
  }
  $chr = processLine($line, $chrom_sizes);
  if ($chr !== FALSE) { $important_chroms[$chr] = TRUE; }
  fclose($temp_fp);
    
  $i = 0;
  foreach(array_keys($important_chroms) as $chr) {
    $rows[] = array($chr, $chrom_sizes[$chr]);
    $i++;
    if ($i > $contig_limit) { break; }
  }
  
  // Throw out everything but the top $contig_limit contigs
  arsort($chrom_sizes);
  $orig_chrom_sizes_length = count($chrom_sizes);
  $biggest_contigs = array_slice($chrom_sizes, 0, $contig_limit);
  foreach ($biggest_contigs as $chr => $size) {
    if (!array_key_exists($chr, $important_chroms)) {
      $rows[] = array($chr, $chrom_sizes[$chr]);
      $i++;
      if ($i > $contig_limit) { break; }
    }
  }
    
  guessIfRoman(array_keys($important_chroms));
  usort($rows, "chrSort");
  
  return array("rows" => $rows, "skipped" => $orig_chrom_sizes_length - $i);
}

// Converts a type from UCSC's trackDb into its corresponding "big" format
// e.g., bed -> bigBed; psl -> bigBed; wig -> bigWig etc.
function littleToBigFormat($format) {
  $format_map = array('bed' => 'bigBed', 'gvf' => 'bigBed', 'wig' => 'bigWig', 'psl' => 'bigBed',
                      'genePred' => 'bigGenePred', 'narrowPeak' => 'bigBed', 'rmsk' => 'bigBed 6 +');
                      // FIXME: make dedicated big* formats for gvf, psl and narrowPeak
  $format_parts = explode(' ', $format);
  if (isset($format_map[$format_parts[0]])) { $format_parts[0] = $format_map[$format_parts[0]]; }
  return implode(' ', $format_parts);
}