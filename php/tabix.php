<?php
/**
 * This page runs a URL to a tabix-indexed file and a series of positions through tabix.
 * Symlink tabix to the ../bin directory
 **/
require_once('../lib/setup.php');

function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}
 
if (!!validate_URL_in_GET_param('url', FALSE)) { bad_request(); }
passthru_basic_auth_for_GET_param('url');
if (!isset($_GET['range'])) { bad_request(); } 
else { $range = array_filter((array) $_GET['range']); }
if (!count($range)) { bad_request(); }

$TABIX = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/tabix');

$tmp_dir = '/tmp/tabix-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);
header('Content-type: text/plain');
passthru("$TABIX " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $range)));
