<?php
/**
 * This page retrieves chromosome sizes for a particular genome from UCSC
 **/

header("Content-type: application/json");
header("Cache-control: max-age=172800, public, must-revalidate");
header('Expires: '.gmdate('D, d M Y H:i:s \G\M\T', time() + 172800));

require_once("../lib/spyc.php");
require_once("../lib/setup.php");
require_once("../lib/chromsizes.php");

function forbidden($err) { 
  header('HTTP/1.1 403 Forbidden'); 
  if (strlen($err)) { echo json_encode(array('error'=>$err)); } 
  exit;
}

$response = array();

$ucsc_config = Spyc::YAMLLoad(where_is_ucsc_yaml());

$all_genomes_url = $ucsc_config['data_urls']['all_genomes'];
$chrom_info_url = $ucsc_config['data_urls']['chrom_info'];
$prefix = parse_url(preg_replace('/%s.*$/', '', $chrom_info_url), PHP_URL_PATH);
$big_zips = $ucsc_config['data_urls']['big_zips'];

function getAllGenomes() {
  global $all_genomes_url, $prefix, $big_zips;
  $genomes = array();
  $dom = new DOMDocument;
  @$dom->loadHTML(file_get_contents($all_genomes_url));
  $xpath = new DOMXPath($dom);
  $node_list = $xpath->query("//a[starts-with(@href,'$prefix')][contains(@href,'$big_zips')]");

  foreach($node_list as $node) {
    $genome = array();
    $genome['name'] = preg_replace('/\/.*$/', '', substr($node->attributes->getNamedItem('href')->nodeValue, strlen($prefix)));
    $sibling_table = $xpath->query("./ancestor::table[1]/preceding-sibling::table[1]", $node);
    if ($sibling_table->length == 1) {
      $genome['species'] = preg_replace('/^[^\x21-\x7E]+|\\s+genome\\s+$/i', '', $sibling_table->item(0)->textContent);
    }
    $desc_nodes = $xpath->query("./ancestor::ul[1]/preceding-sibling::p[1]", $node);
    if ($desc_nodes->length == 1) {
      $genome['assemblyDate'] = preg_replace('/\\s+\\(\\w+(,\\s+\\w+)?\\):?$|/', '', trim($desc_nodes->item(0)->textContent));
    }
    $genomes[] = $genome;
  }
  return $genomes;
}

if (isset($_GET['db'])) {
  // If the db parameter is provided, provide a sorted chrom.sizes file for this genome
  
  $db = preg_replace('/[^a-zA-Z0-9]/', '', $_GET['db']);
  $contig_limit = isset($_GET['limit']) ? min(max(intval($_GET['limit']), 50), 500) : 100;
  
  $chrom_info_url = sprintf($chrom_info_url, $db);
  $chrom_info = '';
  $chrom_sizes = array();
  $rows = array();
  $important_chroms = array();
  $fp = @gzopen($chrom_info_url, 'rb');
  if ($fp === FALSE) {
    // Some chromInfo.txt's are not gzipped
    $fp = @gzopen(preg_replace('/.gz$/', '', $chrom_info_url), 'rb');
  }
  if ($fp !== FALSE) {
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
    
    looksRomanToMe(array_keys($important_chroms));
    usort($rows, "chrSort");
  
    $response['db'] = $db;
    $response['limit'] = $contig_limit;
    $response['skipped'] = $orig_chrom_sizes_length - $i;
    $response['mem'] = memory_get_usage();
    $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $rows));
    
    if (isset($_GET['meta'])) {
      foreach (getAllGenomes() as $genome) {
        if ($genome['name'] == $db) { 
          $response['species'] = $genome['species'];
          $response['assemblyDate'] = $genome['assemblyDate']; 
          break;
        }
      }
    }
    
  } else {
    $response['error'] = TRUE;
  }
  
} else {
  // Otherwise, return an array of UCSC genome names, and species/assembly dates for each
  // Compare with UCSCClient#list_genomes and UCSCClient#get_species_and_date in lib/ucsc_stitch.rb
  $response = getAllGenomes();
}

echo json_encode($response);
