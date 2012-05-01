<?php

function forbidden($err) { header('HTTP/1.1 403 Forbidden'); if (strlen($err)) { echo json_encode(array('error'=>$err)); } exit; }

include('../lib/Tyrant.php');

$path = substr($_SERVER['REQUEST_URI'], strlen($_SERVER['SCRIPT_NAME']) + 1);
if (!strlen($path)) { forbidden(); }
list($db, $f) = explode('/', $path, 2);
if (!isset($f)) { forbidden(); }
$db = preg_replace('/[^a-z0-9]/i', '', $db);

try {
  $tt = @Tyrant::connect("/tmp/$db.sock", 0);
} catch (Tyrant_Exception $e) {
  include("../lib/spyc.php");
  if (!file_exists("../$db.yaml")) { forbidden('genome does not exist'); }
  $genome_config = Spyc::YAMLLoad("../$db.yaml");
  try {
    if (!is_array($genome_config['output_tch'])) { throw new Exception("ttserver should be local"); }
    $tt = @Tyrant::connect($genome_config['output_tch'][0], $genome_config['output_tch'][1]);
  } catch (Exception $e) {
    forbidden('Could not connect to ttserver');
  }
}

header('Content-Type: ' . (substr($f, -4)==".png" ? 'image/png' : 'application/json'));

$value = $tt[$f];
if ($value === null) { header('HTTP/1.1 404 Not Found'); }
else {
  header('Expires: ' . gmdate("D, d M Y H:i:s", time() + 60 * 60 * 3) . " GMT");
  header('Cache-Control: public, max-age=10800');
  if ($value == '-') { echo $tt['.null']; }
  else { echo $value; }
}