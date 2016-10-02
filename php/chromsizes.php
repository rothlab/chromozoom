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
require_once("../lib/ucsc_tracks.php");

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
$track_db_path = $ucsc_config['ucsc_cached_track_db'];
$cytoband_bed_path = $ucsc_config['ucsc_cached_track_cytoband'];
$chromozoom_port = $_SERVER["SERVER_PORT"] != 80 ? ":".$_SERVER["SERVER_PORT"] : '';
$chromozoom_uri = "http://" . $_SERVER["SERVER_NAME"] . $chromozoom_port . dirname(dirname($_SERVER['REQUEST_URI']));


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

  $top_chroms = getTopChromSizes($chrom_info_url, $contig_limit);
  
  if ($top_chroms === FALSE) { 
    $response['error'] = TRUE;
  } else {
    $response['db'] = $db;
    $response['limit'] = $contig_limit;
    $response['skipped'] = $top_chroms['skipped'];
    $response['mem'] = memory_get_usage();
    $response['chromsizes'] = implode("\n", array_map("implodeOnTabs", $top_chroms['rows']));
    
    $response['tracks'] = getTracksForDb($track_db_path, $chromozoom_uri, $db, 100);
    $more_tracks = getTracksForDb($track_db_path, $chromozoom_uri, $db, 1000000, TRUE) > count($response['tracks']);
    $response['moreTracks'] = $more_tracks ? (dirname($_SERVER['REQUEST_URI']) . '/ucsc_tracks.php') : FALSE;
    
    $response['cytoBandIdeo'] = getCytoBandIdeo($cytoband_bed_path, $db);
  
    if (isset($_GET['meta'])) {
      foreach (getAllGenomes() as $genome) {
        if ($genome['name'] == $db) { 
          $response['species'] = $genome['species'];
          $response['assemblyDate'] = $genome['assemblyDate']; 
          break;
        }
      }
    }
  }
  
} else {
  // Otherwise, return an array of UCSC genome names, and species/assembly dates for each
  // Compare with UCSCClient#list_genomes and UCSCClient#get_species_and_date in lib/ucsc_stitch.rb
  $response = getAllGenomes();
}

echo json_encode($response);
