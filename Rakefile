$:.unshift File.expand_path("../lib", __FILE__), File.expand_path("../ext", __FILE__)

require 'ucsc_stitch'
require 'subscreens'
c = nil

task :default => :json

directory "bin"
REQUIRED_LINKS = {
  "bigBedSummary" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigBedToBed" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigWigSummary" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigWigInfo" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "tabix" => "http://samtools.sourceforge.net/tabix.shtml"
}
REQUIRED_LINK_WARN = <<-EOS
WARN: could not find the following in your $PATH: %1$s
  You won't need %2$s if you are just tile stitching, but they are needed 
  to serve custom tracks for the ChromoZoom interface.
  To acquire %2$s, try visiting the following sites:
   - %3$s
EOS
$missing_links = {:names=>[], :urls=>[]}
REQUIRED_LINKS.each do |l, url|
  file "bin/#{l}" do |t|
    which = `which #{l}`.strip
    if which.size > 0 then ln_s which, t.name
    else $missing_links[:names] << l; $missing_links[:urls] << url; end
  end
end
REQUIRED_BINS = {"convert"=>"ImageMagick", "montage"=>"ImageMagick", "identify"=>"ImageMagick", "curl"=>"curl"}
file "ucsc.yaml" do
  cp "ucsc.dist.yaml", "ucsc.yaml"
end

desc "Checks that all requirements for ChromoZoom are in place"
task :check => ["ucsc.yaml", "bin"] + REQUIRED_LINKS.keys.map{|l| "bin/#{l}" } do |t|
  if missing = REQUIRED_BINS.keys.find{|b| `which #{b}`.strip.size == 0 }
    fail "FAIL: Could not find \`#{missing}\` in your $PATH; please ensure #{REQUIRED_BINS[missing]} is installed."
  end
  if $missing_links[:names].size > 0
    puts REQUIRED_LINK_WARN % [
      $missing_links[:names].join(", "), 
      $missing_links[:names].size > 1 ? "them" : "it", 
      $missing_links[:urls].uniq.join("\n   - ")
    ]
  end
  c = UCSCClient.new
end

desc "Interactively create a base YAML configuration file for a genome database @ UCSC"
task :config, [:genome] => :check do |t, args|
  genome = args.genome || c.pick_genome
  Rake::Task["#{genome}.yaml"].invoke
  c.genome = genome
end

desc "Create tiles for a genome (optionally using multiple workers)"
task :tiles, [:genome, :exhaustive, :workers] => :config do |t, args|
  if !args.workers.nil? && (workers = args.workers.to_i) > 1
    Subscreens.split(workers, "rake tiles[#{args.genome || c.genome},#{args.exhaustive || ''}]")
  else
    c.make_tiles(:exhaustive => args.exhaustive)
  end
end

desc "Check the status of tracks for a genome"
task :stat_tiles, [:genome, :exhaustive] => :config do |t, args|
  c.make_tiles(:dry_run => true, :exhaustive => args.exhaustive)
end

desc "Rebuilds the JSON file that holds a genome's configuration for the ChromoZoom web interface"
task :json, [:genome, :skip_tiles] => [:config, :json_clean] do |t, args|
  $skip_tiles = args.skip_tiles
  Rake::Task["#{c.genome}.json"].invoke
end

desc "Creates/updates a Tokyo Cabinet hashtable from an existing directory of tile images"
task :tch, [:genome] => :config do |t, args|
  fail "You must specify the genome as an argument, e.g., \"rake tch[hg18]\"" unless args.genome || c.genome
  Rake::Task["#{args.genome || c.genome}.tch"].invoke
end

desc "Warms up the search cache for a genome"
task :search_tch, [:genome] => :config do |t, args|
  fail "You must specify the genome as an argument, e.g., \"rake search_tch[hg18]\"" unless args.genome || c.genome
  c.prefill_search_tch
end

desc "Deletes the JSON file that holds a genome's configuration for the ChromoZoom web interface"
task :json_clean, [:genome] do |t, args|
  fail "You must specify the genome as an argument, e.g., \"rake json_clean[hg18]\"" unless args.genome || c.genome
  rm "#{args.genome || c.genome}.json", :force => true
end

desc "Builds a native extension that speeds up image processing"
task :build_native, [:debug] do |t, args|
  Dir.chdir('ext') do
    sh "ruby extconf.rb#{args.debug && ' debug'} && make clean && make"
  end
end

rule '.yaml' do |t|
  genome = t.name.sub(/\.yaml$/, '')
  c.make_config(t.name, genome)
  # If we generated a config on the way to doing other things, offer the user a chance to hand-edit it first
  unless Rake.application.top_level_tasks.reject{|arg| arg[/^config|^#{Regexp.escape(t.name)}$/] }.size == 0
    edit_first = !prompt("Do you want to hand-edit your configuration before proceeding? [Y/n]")[/n/i]
    if edit_first
      fail "Edit #{genome}.yaml and then run \"rake\" again to proceed with making tiles."
    end
  end
end

rule '.json', [:skip_tiles] do |t, args|
  c.genome = t.name.sub(/\.json$/, '')
  Rake::Task[:tiles].invoke unless $skip_tiles
  c.make_json(t.name)
end

rule '.tch' do |t|
  c.genome = t.name.sub(/\.tch$/, '')
  c.make_tch(t.name)
end