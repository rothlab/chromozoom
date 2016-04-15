#!/bin/sh

files=$(git diff-index --name-status --cached HEAD | grep -v ^D | cut -c3-)

if [[ "$files" = *.js ]]
then
  echo "Checking build/*.js and recompiling with browserify as needed..."
  browserify_out=$(rake browserify 2>&1 | grep -c '^browserify')
  if [[ "$browserify_out" != "0" ]]
  then
    echo "browserify had to recompile the JS in build, try committing again"
    exit 1
  fi
fi
exit
