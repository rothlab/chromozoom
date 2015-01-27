<?php
/**
 * This page retrieves genome info for a IGB Quickload directory
 * or one of the genomes contained therein.
 * This format is documented at: https://wiki.transvar.org/confluence/display/igbman/Creating+QuickLoad+Sites
 * An example of a directory is: http://igbquickload.org/quickload/
 **/

header("Content-type: application/json");
// header("Cache-control: max-age=172800, public, must-revalidate");
// header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800)); // Have this page expire within 48 hours.

require_once("../lib/spyc.php");
require_once("../lib/setup.php");

function forbidden($err) { header('HTTP/1.1 403 Forbidden'); if (strlen($err)) { echo json_encode(array('error'=>$err)); } exit; }

$response = array();

$ucsc_config = Spyc::YAMLLoad(where_is_ucsc_yaml());

$default_igb_dirs = isset($ucsc_config['igb_dirs']) ? $ucsc_config['igb_dirs'] : array('http://igbquickload.org/quickload/');
$important_chroms_pattern = '/^chr(?!Un)/';
$looks_roman = FALSE;

function processLine($line, &$chrom_sizes) {
  global $important_chroms_pattern;
  $fields = array_slice(explode("\t", $line), 0, 2);
  if ($fields[0] != '') {
    $chrom_sizes[$fields[0]] = $fields[1];
    if (preg_match($important_chroms_pattern, $fields[0])) { return $fields[0]; }
  }
  return FALSE;
}

function implodeOnTabs($row) {
  return implode("\t", $row);
}

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
  global $important_chroms_pattern;
  foreach($chrs as $chr) {
    $roman_chrs += romanToInt(preg_replace($important_chroms_pattern, '', $chr)) > 0 ? 1 : 0;
  }
  return $roman_chrs > count($chrs) * 0.8;
}

// Compare with UCSCClient#chr_sort in lib/ucsc_stitch.rb
function chrSort($rowA, $rowB) {
  global $looks_roman, $important_chroms_pattern;
  list($chrA, $sizeA) = $rowA;
  list($chrB, $sizeB) = $rowB;
  $chrA_is_important = preg_match($important_chroms_pattern, $chrA);
  $chrB_is_important = preg_match($important_chroms_pattern, $chrB);
  
  // important chroms always win
  if ($chrA_is_important && !$chrB_is_important) { return -1; }
  if (!$chrA_is_important && $chrB_is_important) { return 1; }
  
  // if both are important, sort by the number of the chromosome (can be roman)
  if ($chrA_is_important && $chrB_is_important) {
    $chrA = preg_replace($important_chroms_pattern, '', $chrA);
    $chrB = preg_replace($important_chroms_pattern, '', $chrB);
    if ($looks_roman) {
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

if (isset($_GET['url'])) {
  if ($this_is_a_genome) {
    $chrom_sizes = array();
    $rows = array();
    $important_chroms = array();
    
    // normalize $_GET['url'] for trailing slash
    
    $fp = fopen($_GET['url'] . "/genome.txt");
    $last_line = "";
    while (!feof($fp)) {
      $chunk = $last_line . fread($fp, 1048576); // want to read 1MB at a time
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
    fclose($fp);
    
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
    
    $looks_roman = looksRomanToMe(array_keys($important_chroms));
    usort($rows, "chrSort");
  
    $response['db'] = $db;
    $response['limit'] = $contig_limit;
    $response['skipped'] = $orig_chrom_sizes_length - $i;
    $response['mem'] = memory_get_usage();
    $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $rows));
  } else {
    // this is a Quickload dir, with a contents.txt
    return array(
      $url => array($nice_names => $genome_directory_names)
    )
  }
} else {
  // We don't know what we want. get the contents.txts for all default IGB dirs
  foreach ($default_igb_dirs as $igb_dir) {
    // fetch the contents.txt, parse it...
  }
  return array(
    $url_1 => array($nice_names => $genome_directory_names),
    $url_2 => array($nice_names => $genome_directory_names)
  )
}

echo json_encode($response);
