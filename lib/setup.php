<?php
  
  function not_symlinked_or_found_on_path($bin) {
    $symlink = dirname(dirname(__FILE__)) . '/bin/' . $bin;
    if (@is_executable($symlink)) { return false; }
    $output = array(); $retval = 0;
    exec("which $bin", $output, $retval);
    if ($retval === 0) {
      if (!is_dir(dirname($symlink))) { mkdir(dirname($symlink)); }
      exec("ln -s " . escapeshellarg($output[0]) . " " . escapeshellarg($symlink));
      return false;
    } else {
      return true;
    }
  }
  
  function find_and_link_binaries($bins) {
    return array_filter($bins, 'not_symlinked_or_found_on_path');
  }
  
  function where_is_ucsc_yaml() {
    $ucsc_dist_yaml = dirname(dirname(__FILE__)) . "/ucsc.dist.yaml";
    $ucsc_yaml = dirname(dirname(__FILE__)) . "/ucsc.yaml";
    return file_exists($ucsc_yaml) ? $ucsc_yaml : $ucsc_dist_yaml;
  }