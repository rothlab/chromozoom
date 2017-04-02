require_relative 'lib/subscreens'
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
  You will need this program to fetch data for the web frontend.
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
REQUIRED_SCRAPING_BINS = {
  "fetchChromSizes"=>"http://hgdownload.cse.ucsc.edu/admin/exe/",
  "bedToBigBed"=>"http://hgdownload.cse.ucsc.edu/admin/exe/",
  "curl"=>"https://curl.haxx.se/"
}
REQUIRED_SCRAPING_BINS_WARN = <<-EOS
WARN: could not find the following in your $PATH: %1$s
  You don't need this program to serve the web frontend of ChromoZoom,
  but you do need it to scrape track data from UCSC.
  To acquire %2$s, try visiting the following sites:
   - %3$s
EOS
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

desc "Builds minified (production) ChromoZoom javascripts, outputting them in build/"
task :browserify => JAVASCRIPTS

desc "Builds debuggable versions of ChromoZoom javascripts, updating them upon file save"
task :watchify do
  # Useful for development. Compiles in debug mode (with source maps) while you edit the source.
  cmds = JAVASCRIPTS.map{ |js| "watchify -d #{sources_for_javascript(js).first} -o #{js} -v"}
  Subscreens.split(JAVASCRIPTS.size, cmds)
end

desc "Checks that all requirements for ChromoZoom are in place"
task :check => [:browserify, "ucsc.yaml", "bin"] + REQUIRED_LINKS.keys.map{|l| "bin/#{l}" } do |t|
  missing = REQUIRED_SCRAPING_BINS.keys.select{|b| `which #{b}`.strip.size == 0 }
  if missing.size > 0
    puts REQUIRED_SCRAPING_BINS_WARN % [
      missing.join(", "), 
      missing.size > 1 ? "them" : "it", 
      REQUIRED_SCRAPING_BINS.values_at(*missing).uniq.join("\n   - ")
    ]
  end
  if $missing_links[:names].size > 0
    fail REQUIRED_LINK_WARN % [
      $missing_links[:names].join(", "), 
      $missing_links[:names].size > 1 ? "them" : "it", 
      $missing_links[:urls].uniq.join("\n   - ")
    ]
  end
end