#!/bin/sh

files=$(git diff-index --name-status --cached HEAD | grep -v ^D | cut -c3-)

if echo $files | grep -e ".js" > /dev/null
then
    echo "Checking build/*.js and recompiling with browserify as needed..."
    if grep --quiet '^//# sourceMappingURL=' build/*.js
    then
        echo "Source maps detected in build/*.js, recompiling..."
        rm build/*.js
    fi
    browserify_out=$(rake browserify 2>&1 | grep -c '^browserify')
    if [[ "$browserify_out" != "0" ]]
    then
        echo "browserify had to recompile the JS in build, try committing again"
        exit 1
    fi
fi
exit
