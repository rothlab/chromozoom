$:.unshift File.expand_path("../lib", __FILE__)

require 'ucsc_stitch'
require 'subscreens'
c = nil

task :default => :check

directory "bin"
REQUIRED_LINKS = {
  "bigBedSummary" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigBedToBed" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigBedInfo" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigWigSummary" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bigWigInfo" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "twoBitToFa" => "http://hgdownload.cse.ucsc.edu/admin/exe/",
  "tabix" => "http://www.htslib.org/download/",
  "samtools" => "http://www.htslib.org/download/"
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

directory "build"
JAVASCRIPTS = ["build/chromozoom.js", "build/CustomGenomeWorker.js", "build/CustomTrackWorker.js"]
def sources_for_javascript(js)
  Dir.glob('js/**/*.js').sort_by{ |src| src.match(/#{File.basename js}$/) ? -1 : 1 }
end
rule /^build\/.+\.js$/ => proc { |js| sources_for_javascript js } do |t|
  sh "browserify #{t.sources.first} | uglifyjs > #{t.name}"
end

task :browserify => JAVASCRIPTS
task :watchify do
  # Useful for development. Compiles in debug mode (with source maps) while you edit the source.
  cmds = JAVASCRIPTS.map{ |js| "watchify -d #{sources_for_javascript(js).first} -o #{js} -v"}
  Subscreens.split(JAVASCRIPTS.size, cmds)
end

desc "Checks that all requirements for ChromoZoom are in place"
task :check => [:browserify, "ucsc.yaml", "bin"] + REQUIRED_LINKS.keys.map{|l| "bin/#{l}" } do |t|
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