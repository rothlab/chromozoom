#!/usr/bin/env ruby

# libraries provided by ruby
require 'rubygems'
require 'zlib'
require 'yaml'
require 'open-uri'
require 'tempfile'
require 'fileutils'
require 'find'

# gems you will need (run bundle install to get them)
require "bundler/setup"
require 'json'
require 'nokogiri'
require 'bsearch'
require 'htmlentities'
begin
  TC_ENABLED = require('rufus/tokyo') && require('rufus/tokyo/tyrant')
rescue LoadError; TC_ENABLED = false; end

# our (small) libraries
require 'ucsc_stitch/core_ext'
require 'ucsc_stitch/term_util'
include TermUtil
require 'ucsc_stitch/interim_file'
require 'ucsc_stitch/image_manip'
require 'ucsc_stitch/image_map'
begin
  PNGFIFO_ENABLED = require('png_fifo_chunker')
rescue LoadError; PNGFIFO_ENABLED = false; end

class UCSCClient
  attr_reader :genome, :genome_config, :ucsc_config
  include ImageManip
  include PNGFIFO if PNGFIFO_ENABLED
  
  def initialize(genome=nil)
    @ucsc_config = YAML.load_file("ucsc.yaml")
    @init_pwd = Dir.pwd
    @lock = nil
    self.genome = genome unless genome.nil?
    if !File.executable?("#{@ucsc_config['cgi_bin_dir']}/hgTracks") && @ucsc_config['scrape_method'] == 'cgi_bin'
      puts "WARN: cgi_bin_dir does not contain an executable hgTracks, scrape_method reverted to 'local'"
      @ucsc_config['scrape_method'] = 'local'
    end
    puts "WARN: could not load rufus/tokyo gem, disabling Tokyo Cabinet support" unless TC_ENABLED
    puts "WARN: could not load native image processing extension" unless PNGFIFO_ENABLED
    @layout_config = @ucsc_config['layout']['default']
    @layout_config.merge! @ucsc_config['layout']['local'] unless @ucsc_config['scrape_method'] == 'authoritative'
  end
  
  def genome=(genome)
    @genome = genome
    @genome_config = YAML.load_file("#{@genome}.yaml")
    @genome_config['_name'] = @genome
    @tile_every = @genome_config['tile_every']
    unless @genome_config['output_tch'].nil?
      @tile_db = start_ttserver(@genome_config['output_tch'])
    end
    @optimized_chunking = @tile_db && TC_ENABLED && PNGFIFO_ENABLED
  end
  
  # Fetches a piece of a track for a given chromsome/start/end given a bppp/size, possibly with the area map
  def get_track_piece(track, chr, start, fin, bppp, size='dense', get_map=false, extra_opts={})
    bppp_limits = @genome_config['bppp_limits']['track']
    raise 'bad bppp' if bppp > bppp_limits[1] or bppp < bppp_limits[0]
    raise 'bad bp range' unless (1..@genome_config['chr_lengths'][chr]) === start and fin > start
    raise 'invalid track' unless @genome_config['all_tracks'].find{|t| t['n'] == track }
    
    opts = {}
    loc = "#{chr}:#{start.to_i}-#{fin.to_i}"
    
    # Develop a strategy for getting all the pixels we need within the window
    pix_data = ((fin - start + 1) / bppp.to_f).round.to_i
    pix_data_range = @layout_config['pixel_data']
    raise 'pix_data too big' if pix_data > pix_data_range[1]
    opts['hgt.labelWidth'] = @layout_config['hgt.labelWidth'][pix_data > (pix_data_range.inject(:+) / 2) ? 0 : 1]
    label_fn = @layout_config['label_width_fn']
    pix_margin = (opts['hgt.labelWidth'] * label_fn['m'] + label_fn['b'] + label_fn['blank']).to_i
    if pix_data < pix_data_range[0]
      # back up the start point to grab more bp's to fill the window, and crop it out later.
      pix_margin += pix_data_range[0] - pix_data
      start = (fin - pix_data_range[0] * bppp.to_f + 1).round.to_i
    end
    opts['pix'] = pix_margin + pix_data + @layout_config['right_blank']
    # Refuse to fetch more pix than allowed by hgTracks
    raise 'pix out of range' unless Range.new(*@layout_config['pix']) === opts['pix']
    
    # Set visibility of the tracks so we just get the one track we want
    @genome_config['default_tracks'].each {|trk| opts[trk] = 'hide'}
    extra_opts.each{|k, v| opts["#{track}.#{k}"] = v } unless extra_opts.nil?
    opts[track] = size
    
    # Fetch it and parse it
    fetch_into_nokogiri(base_uri, opts, loc) do |doc, remote|
      nk = doc.xpath("//img[starts-with(@src,'#{remote ? "../trash" : "."}/hgt/hgt_')]")
      err = doc.xpath("//script[contains(.,'warnList.innerHTML +=')]")

      # Grab the image and put it into an InterimFile
      temp_file = InterimFile.new(false, ['ucsc','.png'])
      # keep an eye on fractional pixel errors
      temp_file.pix_err = ((fin - start + 1) / bppp.to_f) - pix_data
      if !err.empty?
        err.first.content =~ /warnList\.innerHTML \+= '<li>([^<]+)</
        raise "Error while fetching #{loc} - #{HTMLEntities.new.decode($1)}"
      elsif nk.empty?
        # if the move left button didn't appear, something bad must have happened.
        if doc.xpath("//input[@name='hgt.left3']").empty?
          raise "An unspecified error occurred while fetching #{loc}."
        end
        # if it did, we're probably OK, it's just there was no data for the region; generate a blank image
        null_img(temp_file.path, "#{pix_data}x1")     
        temp_file.pix_data, temp_file.pix_margin = pix_data, 0 if @optimized_chunking
      else
        fetch_img(nk.first['src'], temp_file.path, remote && base_uri)
        if @optimized_chunking then temp_file.pix_data, temp_file.pix_margin = pix_data, pix_margin
        else crop_img(temp_file.path, temp_file.path, "#{pix_data}x+#{pix_margin}+0"); end
      end
      nk_map = doc.at_css("[name=#{nk.first['usemap'].sub(/^#/, '')}]") unless nk.empty? or nk.first['usemap'].nil?
      temp_file.map = ImageMap.new(opts['pix'], @genome_config, nk_map, chr) << pix_margin unless !get_map
      temp_file
    end
  end
  
  # Gets a complete track at a given bppp/size, possibly starting from the middle, and/or with area maps
  def get_track(track, bppp, size="dense", start_at=1, end_at=nil, get_map=false, extra_opts={})
    start_at ||= 1
    start_time = Time.new
    max_pix_data = @layout_config['pixel_data'][1]
    # Try to minimize fractional pixel errors
    bp_window_step = (max_pix_data.step(1, -1).find{|x| y = (x * bppp); y - y.to_i < 0.01 } * bppp).to_i
    breaks = []
    pix_err = 0.0
    bp_count = prev_break = 0
    chr_order = @genome_config['chr_order']
    chr_order.each do |chr|
      bp_count += @genome_config['chr_lengths'][chr]
      if end_at && bp_count >= end_at then bp_count = end_at; breaks.push(:len => end_at, :chr => chr); break
      elsif bp_count > start_at then breaks.push(:len => bp_count, :chr => chr)
      else prev_break = bp_count; end
    end
    bp = tile_bp = start_at.to_i
    prev_file = nil
    subdir = tile_subdir(track, bppp, size, @tile_every > 0)
    track_summary = "#{track} @ #{bppp}/#{size} (#{start_at.commify}-#{bp_count.commify})"
    return "Another process is working on #{track_summary}" unless lock_subdir(subdir, true, end_at)
    return "Need to fetch track #{track_summary}" if @dry_run
    puts "Fetching track #{track_summary} :: #{start_time.strftime '%T'}"
    
    Dir.mktmpdir do |temp_dir|
      until breaks.empty?
        # Determine what piece to fetch (chromosome:start-end)
        chr = breaks.first[:chr]
        piece_end = [bp + bp_window_step - 1, breaks.first[:len]].min
        progress = ((bp - start_at) / (bp_count - start_at + 1).to_f)
        remain = ((Time.new - start_time) * (1.0 / progress - 1.0)).duration
        print_over "#{chr}:#{bp - prev_break}-#{piece_end - prev_break} (#{'%2.1f' % (progress*100)}%, #{remain} remain, "\
          + "err: #{'%0.3f' % pix_err}px) :: #{Time.new.strftime '%T'}"
          
        # Fetch it
        new_file = get_track_piece(track, chr, bp - prev_break, piece_end - prev_break, bppp, size, get_map, extra_opts)
        pix_err += new_file.pix_err
        
        # Glue it to the previously fetched image and chunk tiles off the front, saving them to disk or Tokyo Cabinet.
        prev_file, tile_bp = chunk_into_tiles(prev_file, new_file, bppp, size, tile_bp, get_map, subdir, temp_dir)
        
        # Setup for the next genome piece that needs to be fetched.
        bp = piece_end + 1
        prev_break = breaks.shift[:len] if piece_end == breaks.first[:len]
      end
          
      if @tile_every == 0
        File.rename(prev_file.path, "#{subdir}.png")
      elsif prev_file
        dest = tile_dest(subdir, tile_bp, bppp)
        # Pad out the last image to @tile_every px (and crop to content_height, if needed)
        if size != 'dense' 
          extend_img(prev_file.path, dest, "#{@tile_every}x#{[img_content_height(prev_file.path), 1].max}+0+0")
        else extend_img(prev_file.path, dest, "#{@tile_every}x+0+0", false); end
        prev_file.map.save("#{dest}.json") unless !get_map || !prev_file.map
        save_into_tch(dest, :with_map=>(get_map && prev_file.map), :delete_file=>true)
        prev_file.close!
      end
    end
    
    lock_subdir(subdir, false)
    return "\nFinished track #{track_summary} :: #{Time.new.strftime '%T'}"
  end
  
  # Gets an ideogram image for a chromosome at a given bppp and returns it as an InterimFile
  def get_ideogram(chr, bppp)
    # this is a lot harder to do for a particular bppp, because of the limitations on how the ideogram
    # is drawn; fewer parameters influence it directly, and the label size is hard to predict.
    bppp_limits = @genome_config['bppp_limits']['ideogram']
    print_over "#{chr}"
    raise 'bad bppp' if bppp > bppp_limits[1] or bppp < bppp_limits[0]
    raise 'bad chr' unless @genome_config['chr_lengths'].key?(chr)
    
    crop = @ucsc_config['ideogram']['crop']
    anticipated_left = crop['left']
    temp_file = nil
    until temp_file and not temp_file.closed?
      opts = {}
      shrink_to = nil
    
      chr_len = @genome_config['chr_lengths'][chr]
      pix_data = chr_len / bppp.to_f
      pix_scale = @ucsc_config['ideogram']['scale_from_tracks']
      opts['pix'] = ((pix_data + anticipated_left + crop['right']) / pix_scale).round.to_i
      pix_data_range = @layout_config['pix']
      raise 'pix_data out of range' if opts['pix'] > pix_data_range[1]
      if opts['pix'] < pix_data_range[0] then opts['pix'] = shrink_to = pix_data_range[0]; end
    
      fetch_into_nokogiri(base_uri, opts, "#{chr}:1-2") do |doc, remote|
        nk = doc.xpath("//img[starts-with(@src,'#{remote ? "../trash" : "."}/hgtIdeo/hgtIdeo_')]")
        raise 'Could not find the <img> in the document' if nk.empty?
        temp_file = InterimFile.new(false, ['ucsc','.png'])
        fetch_img(nk.first['src'], temp_file.path, remote && base_uri)
        true_left = find_red_pixel(temp_file)
        if anticipated_left - true_left == 0
          real_width = (opts['pix'] * pix_scale - true_left - crop['right']).round.to_i
          crop_img(temp_file.path, temp_file.path, "#{real_width}x+#{true_left}+0")
          unless shrink_to.nil?
            resize_img(temp_file.path, temp_file.path, "#{pix_data}x25!")
          end
        else
          anticipated_left = true_left
          temp_file.close!
        end
      end
    end
    return temp_file
  end
  
  # Gets an ideogram track for a genome
  def get_ideogram_track(bppp)
    chr_order = @genome_config['chr_order']
    ideos = []
    last_img = nil
    subdir = tile_subdir('ideograms', bppp, '', @tile_every > 0)
    return "\nAnother process is working on ideograms @ #{bppp}" unless lock_subdir(subdir, true)
    return "Need to fetch ideograms @ #{bppp}" if @dry_run
    puts "Fetching ideograms @ #{bppp}"
    
    chr_order.each do |chr|
      ideos.push get_ideogram(chr, bppp)
    end
    temp_file = InterimFile.new(false, ['ucsc','.png'])
    montage_imgs(ideos.map {|x| x.path}, temp_file.path)
    if @tile_every and (width = img_width(temp_file.path)) > @tile_every
      crop_img(temp_file.path, "#{subdir}/temp-%d.png", "#{@tile_every}x", (width / @tile_every.to_f).ceil)
      (0..(width / @tile_every).floor).each do |num|
        save_into_tch(last_img, :with_map=>false, :delete_file=>true) unless last_img.nil?
        tile_bp = (@tile_every * bppp * num).to_i + 1
        last_img = tile_dest(subdir, tile_bp, bppp, true)
        File.rename("#{subdir}/temp-#{num}.png", last_img)
      end
    elsif @tile_every == 0
      File.rename(temp_file.path, "#{subdir}.png")
    else
      File.rename(temp_file.path, last_img = tile_dest(subdir, 1, bppp, true))
    end
    unless last_img.nil?
      extend_img(last_img, last_img, "#{@tile_every}x", false)
      save_into_tch(last_img, :with_map=>false, :delete_file=>true)
    end
    ideos.each {|file| file.close!}
    temp_file.close!
    lock_subdir(subdir, false)
    return "\nFinished ideograms @ #{bppp}"
  end
  
  # For the given track, bppp, and size, determine the current status of tile generation
  def stat_track(track, bppp, size='dense', slices=1, needs_map=false)
    slice_size = (1 / slices.to_f) * genome_size
    bp_per_tile = bppp * @tile_every
    subdir = tile_subdir(track, bppp, size, false)
    now = Time.new
    expirations = @ucsc_config['get_if_older_than']
    stat_from_tch = @tile_db[subdir] unless @tile_db.nil?
    
    (0...slices).each do |slice|
      start_at = ((slice_size * slice / bp_per_tile.to_f).ceil * bp_per_tile + 1).to_i
      end_at = ((slice + 1) * slice_size).to_i
      valid_bps = (start_at..end_at).step(bp_per_tile).to_a
      stat = {
        :started=>false, :last_tile=>nil, :last_updated=>nil, :finished=>false, :too_long=>false, 
        :last_map=>nil, :needs_map=>needs_map, :should_get=>true, :start=>start_at, 
        :end=>(slices > 1 ? (valid_bps.last + bp_per_tile - 1).to_i : nil)
      }
      if @genome_config['output_tch'] ? stat_from_tch : File.directory?(subdir)
        if stat_from_tch
          dirstat = JSON.parse(stat_from_tch)
          ex = lambda{|pos, ext| !@tile_db["#{tile_dest(subdir, pos, bppp, false)}#{ext}"].nil? }
          ctime = lambda{|fname| Time.at(dirstat['ctime']) }
        else
          ex = lambda{|pos, ext| File.exists?("#{tile_dest(subdir, pos, bppp, false)}#{ext}") }
          ctime = lambda{|fname| File.ctime fname }
        end
        stat[:started] = ex[start_at, '']
        map_started = ex[start_at, '.json']
        
        # Search for the last tile for which we can find a PNG file in the subdir/hashtable
        if @exhaustive_below && bppp <= @exhaustive_below
          # We've been ordered to search every last position
          last_bp_i = valid_bps.find_index {|pos| !ex[pos + bp_per_tile, ''] }
          last_map_i = valid_bps.find_index {|pos| !ex[pos + bp_per_tile, '.json'] }
        else
          # Binary search is faster, assuming tiles are contiguous within each slice (usually true)
          last_bp_i = valid_bps.bsearch_first {|pos| ex[pos, ''] ? (ex[pos + bp_per_tile, ''] ? -1 : 0) : 1 }
          last_map_i = valid_bps.bsearch_first {|pos| ex[pos, '.json'] ? (ex[pos + bp_per_tile, '.json'] ? -1 : 0) : 1 }
        end
        stat[:last_tile] = valid_bps[last_bp_i].to_i if last_bp_i && stat[:started]
        stat[:last_map] = valid_bps[last_map_i].to_i if last_map_i && map_started
      
        if ex[valid_bps.last + bp_per_tile, ''] # Tiles beyond the end of this slice make the searches return nil.
          stat[:too_long] = true if slice + 1 == slices
          stat[:last_tile] ||= valid_bps.last if ex[valid_bps.last, ''] && stat[:started]
          stat[:last_map] ||= valid_bps.last if ex[valid_bps.last, '.json'] && map_started && needs_map
        end
      
        if stat[:last_tile]
          last_files = [subdir, tile_dest(subdir, stat[:last_tile], bppp, false),
            stat[:last_map] && "#{tile_dest(subdir, stat[:last_map], bppp, false)}.json"]
          stat[:last_updated] = last_files.reject{|f| f.nil? }.map(&ctime).max 
          stat[:finished] = stat[:last_tile] == valid_bps.last && (!needs_map || stat[:last_map] == valid_bps.last) 
        else stat[:last_updated] = ctime[subdir]; end
              
        stat[:should_get] = [now - stat[:last_updated], 0].max > expirations[stat[:finished] ? 'finished' : 'unfinished']
        stat[:start] = [stat[:last_tile], needs_map && (stat[:last_map] || start_at)].find_all{|x| x }.min || start_at
      end
      yield stat, [slice + 1.to_i, slices]
    end
  end
  
  # Create tiles for an entire genome as specified by the @genome_config
  def make_tiles(options={})
    @dry_run = options[:dry_run]
    @exhaustive_below = options[:exhaustive] && options[:exhaustive].to_f
    
    Dir.mkdir(@genome_config['output_dir'], 0755) unless File.directory?(@genome_config['output_dir'])
    Dir.chdir(@genome_config['output_dir'])
    File.open('.gitignore', 'w') {|f| f.write("/*\n") } unless File.exists?(".gitignore")
    
    tracks = @genome_config['serve_tracks']
    slice_under = @genome_config['slice_for_bppps_under'] || 0
    tracks = [(tracks + @genome_config['all_tracks']).find{|trk| trk['n'] == options[:track] }] if options[:track]
    bppps = options[:bppp] ? [options[:bppp].to_f] : @genome_config['bppps']
    force_map = options[:force_map].is_a?(String) ? !options[:force_map].empty? : options[:force_map]

    bppps.each do |bppp|
      tracks.each do |trk|
        if trk['n'] == 'ruler'
          if bppp > @genome_config['bppp_limits']['ideograms_above'] && @genome_config['chr_bands']
            stat_track('ideograms', bppp, '') do |stat, sl|
              if stat[:should_get] then puts get_ideogram_track(bppp)
              else puts "Already have ideograms @ #{bppp}" ; end
              $stdout.flush
            end
          end
        else
          slices = bppp < slice_under ? (slice_under / bppp.to_f).floor : 1
          each_size(options[:size] ? [options[:size]] : trk['s'], bppp) do |size|
            stat_track(trk['n'], bppp, size, slices, force_map || (trk['m'] && trk['m'].include?(size))) do |stat, slice|
              slice_desc = slice[1] > 1 ? " (#{slice[0]}/#{slice[1]})" : ''
              if stat[:should_get]
                puts get_track(trk['n'], bppp, size, stat[:start], stat[:end], stat[:needs_map], trk['o'])
              elsif stat[:too_long] then puts "WARN: Track #{trk['n']} @ #{bppp}/#{size}#{slice_desc} is too long!"
              else puts "Already have #{trk['n']} @ #{bppp}/#{size}#{slice_desc}"; end
              $stdout.flush
            end
          end
        end
      end
    end
    
    Dir.chdir(@init_pwd)
    puts "Finished making tiles for all tracks." unless options[:dry_run]
  end
  
  # Create the JSON file that holds the run-time configuration for the ChromoZoom web interface
  def make_json(save_to=nil, format=nil)
    serve_tracks = @genome_config['serve_tracks']
    puts "Generating JSON run-time configuration."
    add_fixed_heights(serve_tracks)
    
    options = {
      "species"=>@genome_config['species'],
      "assemblyDate"=>@genome_config['assembly_date'],
      "availTracks"=>serve_tracks,
      "chrLengths"=>@genome_config['chr_lengths'],
      "chrOrder"=>@genome_config['chr_order'],
      "chrBands"=>@genome_config['chr_bands'],
      "ideogramsAbove"=>@genome_config['bppp_limits']['ideograms_above'],
      "bpppNumbersBelow"=>@genome_config['bppp_limits']['bppp_numbers_below'],
      "ntsBelow"=>@genome_config['bppp_limits']['nts_below'],
      "subdirForBpppsUnder"=>@genome_config['subdir_for_bppps_under'],
      "bppps"=>@genome_config['bppps'],
      "overzoomBppps"=>@genome_config['overzoom_bppps'] || [],
      "initZoom"=>@genome_config['bppps'].first,
      "tileWidth"=>@genome_config['tile_every'],
      "genome"=>@genome,
      "ucscURL"=>@ucsc_config['browser_hosts']['authoritative'] + @ucsc_config['browser_urls']['tracks'],
      "genomeSize"=>genome_size,
      "maxNtRequest"=>@genome_config['max_nt_request'],
      "tileDir"=>!@genome_config['output_tch'].nil? ? "php/tt.php/#{@genome}/" : @genome_config['output_dir'],
      "trackDesc"=>Hash[@genome_config['track_desc'].select{|k,v| serve_tracks.find{|t| t['n']==k }}],
      "trackDescURL"=>@ucsc_config['browser_hosts']['authoritative'] + @ucsc_config['browser_urls']['track_desc'],
      "tracks"=>@genome_config['init_tracks'].map{|n| {"n"=>n} }
    }
    
    json = format=='pretty' ? JSON.pretty_generate(options) : options.to_json
    save_to = prompt("Where do you want to save the JSON options file?", "#{@genome}.json") if save_to.nil?
    File.open(save_to, 'w') {|f| f.write(json) }
    puts "Saved JSON run-time configuration to #{save_to}."
    FileUtils.ln_s save_to, '_default.json' unless File.exists?('_default.json')
  end
  
  # Create a Tokyo Cabinet hashtable from an existing directory of tile images
  def make_tch(save_to=nil)
    raise "The Tokyo Cabinet gems have not been installed." unless TC_ENABLED
    save_to = prompt("Where do you want to save the TCH file?", @genome_config['output_tch']) if save_to.nil?
    Dir.chdir(@genome_config['output_dir'])
    i = 0
    Find.find('./') do |d|
      next unless d[/\.(png|json)$/]
      save_into_tch(d, :save_to=>save_to)
      puts d if i % 100000 == 0
      i += 1
    end
  end
  
  # Interactively select a genome database @ UCSC
  def pick_genome(genome=nil) 
    @chrom_info = nil
    pick_prompt = 'Enter a genome name (To list all genomes on UCSC, type "list")'
    while @chrom_info.nil?
      while genome.nil? or genome.strip.empty? or genome=='list' do
        genome = prompt((genome=='list' ? grid(list_genomes) : '') + pick_prompt)
      end
      begin
        stream = URI.parse(@ucsc_config['data_urls']['chrom_info'] % genome).open
        gz = Zlib::GzipReader.new(stream)
        @chrom_info = gz.read.split("\n").map{|l| l.split("\t") }
      rescue OpenURI::HTTPError
        puts "Couldn't retrieve chromosome information for #{genome}"
        genome = nil
      end
    end
    @genome = genome
  end
  
  # An interactive wizard for generating a base config file for a genome database @ UCSC
  def make_config(save_to=nil, genome=nil)
    @genome = genome unless genome.nil?
    config = {}
    pick_genome(@genome) if @genome.nil? || @chrom_info.nil?
    config.merge! get_species_and_date
    puts "You have selected the #{config['species']} genome, assembly date #{config['assembly_date']}"
    puts "Fetched information for #{@chrom_info.size} chromosomes"
    
    # Set chromosome lengths and order
    config['chr_lengths'] = {}
    chr_order = chr_sort(@chrom_info.map{|r| r[0]}.reject{|c| c.match(@ucsc_config['reject_chrs']) })
    order_ok = !prompt(grid(chr_order) + "Here's the chromosome order I guessed, is it OK? [Y/n]")[/n/i]
    until order_ok
      puts "Here are all of the chromosomes for this genome:\n" + grid(chr_sort(@chrom_info.map{|r| r[0]}))
      chr_order = [chr = prompt("Enter in your desired order, one per line, ending with a blank line.\n")]
      until (chr = prompt).empty? ; chr_order.push(chr) ; end
      if !chr_order.size then puts "You need to enter at least one chromosome."
      elsif invalid_chr = chr_order.find{|chr| !@chrom_info.find{|r| r[0] == chr}} 
        puts "#{invalid_chr} is not a valid chromosome!"
      else order_ok = true
      end
    end
    def chr_order.to_yaml_style; :inline; end
    config['chr_order'] = chr_order
    chr_order.each{|c| config['chr_lengths'][c] = @chrom_info.find{|r| r[0]==c }[1].to_i }
    genome_size = config['chr_lengths'].values.inject(0, :+)
    
    # Get chromosome bands, if available
    begin
      stream = URI.parse(@ucsc_config['data_urls']['cyto_band'] % @genome).open
      gz = Zlib::GzipReader.new(stream)
      config['chr_bands'] = gz.read.split("\n").map{|l| l.split("\t") }
      puts "Retrieved #{config['chr_bands'].size} chromosome bands"
    rescue OpenURI::HTTPError
      puts "Couldn't retrieve chromosome bands for #{@genome}; proceeding anyway"
    end
        
    # Get all tracks, track descriptions, and the default visibility
    uri = base_uri('authoritative')
    uri.query = {"db" => @genome}.to_query
    doc = Nokogiri::HTML(uri.open)
    nk = doc.xpath("//select")
    raise "Could not find tracks in the Genome Browser for this genome" if nk.empty?
    puts "Fetched names and default visibility for #{nk.size} tracks"
    config['track_desc'] = {}
    config['all_tracks'] = nk.map do |elem|
      a = elem.previous_element
      tr = elem.parent.parent.xpath('./preceding-sibling::tr[th]').last.xpath('.//b').first
      config['track_desc'][elem['name']] = {'sm'=>a.content.strip}
      config['track_desc'][elem['name']]['lg'] = a['title'].strip unless a['title'].nil?
      config['track_desc'][elem['name']]['cat'] = tr.content.strip unless tr.nil?
      {"n"=>elem['name'], "s"=>elem.xpath("option[.!='hide']").map{|e| e.content }}
    end
    config['serve_tracks'] = []
    config['default_tracks'] = doc.xpath("//select[string(option[@selected])!='hide']").map do |elem|
      sizes = [elem.xpath("option[.!='hide']").first.content]
      height = elem['name'] == 'ruler' ? (config['chr_bands'].nil? ? 25 : 50) : 15
      config['serve_tracks'].push({"n"=>elem['name'], "h"=>height, "s"=>sizes})
      elem['name']
    end
    config['init_tracks'] = ['ruler']
        
    # Calculate bppp_limits and bppps
    max_ideo_width = @layout_config['pix'][1] * @ucsc_config['ideogram']['scale_from_tracks'] - 
      @ucsc_config['ideogram']['crop'].values.inject(0, :+)
    config['bppp_limits'] = bppp_limits = {
      # min ideogram bppp constrained by how big you can make the biggest chromosome
      "ideogram"=>[(config['chr_lengths'].values.max / max_ideo_width).to_i, 1.0e+9],
      # max track bppp constrained by how small we can make the smallest chromosome
      "track"=>[0.1, config['chr_lengths'].values.min / @layout_config['pixel_data'][0]],
    }
    def bppp_limits.to_yaml_style; :fold; end
    config['bppps'] = bppps = []
    log = Math.log10(config['bppp_limits']['track'][1]).floor
    # basically, .floor at the 2nd significant digit, so 5292 => 5200
    bppp = ((config['bppp_limits']['track'][1] * 10 / (10 ** log)).floor / 10.0) * (10 ** log)
    lowest_bppp = prompt("Farthest zoom level is #{bppp} bp/pixel; enter the desired closest zoom in bp/pixel",
      config['bppp_limits']['track'][0]).to_f until !lowest_bppp.nil? && lowest_bppp > 0
    while bppp >= lowest_bppp
      config['bppps'].push bppp.to_f
      log = Math.log10(bppp)
      bppp = (log.ceil - log < 0.481) ? 3.3 * (10 ** (log.ceil - 1)) : 10 ** (log.floor)
    end
    ideo_above_index = config['chr_bands'] && bppps.find_index{|b| b < config['bppp_limits']['ideogram'][0] } || 0
    config['bppp_limits']['ideograms_above'] = bppps[ideo_above_index]
    config['bppp_limits']['bppp_numbers_below'] = bppps.slice(ideo_above_index, 2)
    config['bppp_limits']['nts_below'] = [1, 0.1]
    
    # Ask about output_dir and tile_every and subdir_for_bppps_under...
    config['output_dir'] = prompt "Where would you like tile generation to happen?", "#{@genome}/"
    if TC_ENABLED && (!prompt("Should tiles be saved to Tokyo Cabinet instead of the filesystem? [Y/n]")[/n/i])
      config['output_tch'] = prompt "Where should the Tokyo Cabinet hashtable file be built?", "#{@genome}.tch"
    end
    config['tile_every'] = 1000
    subdir_under = bppps.reverse.find(bppps.last){|b| genome_size / b / config['tile_every'] < 9999 }
    config['subdir_for_bppps_under'] = subdir_under.to_f
    config['slice_for_bppps_under'] = bppps.last
    config['max_nt_request'] = 20000
    
    config.yaml_key_order = @ucsc_config['genome_config_key_order']
    save_to = prompt("Where do you want to save the configuration file?", "#{@genome}.yaml") if save_to.nil?
    File.open(save_to, 'w') {|out| YAML.dump(config, out) }
    puts "Saved configuration file to #{save_to}."
  end
  
  # Hits the search service repeatedly to prefill the cache for searching
  def prefill_search_tch
    raise "No search_tch specified in genome configuration" if @genome_config['search_tch'].nil?
    raise "No search_warmup_list specified in genome configuration" if @genome_config['search_warmup_list'].nil?
    w_list = @genome_config['search_warmup_list']
    raise "No search_warmup_list.tsv_url specified in genome configuration" if w_list['tsv_url'].nil?
    raise "No search_warmup_list.columns specified in genome configuration" if w_list['columns'].nil?
    already_did = {}
    Dir.chdir("#{@init_pwd}/php") do
      begin
        tsv = URI.parse(w_list['tsv_url']).open do |f|
          while (l = f.gets) do
            cols = l.split("\t")
            w_list['columns'].each do |c|
              next unless cols.size > c
              (0...[cols[c].size, 8].min).each do |chrs|
                query = cols[c][0...chrs]
                next if already_did[query]
                puts cols[c][0...chrs]
                `php search.php #{@genome} #{cols[c][0...chrs]} 2>&1 >/dev/null`
                already_did[query] = true
              end
            end
          end
        end
      rescue OpenURI::HTTPError
        raise "Couldn't retrieve gene names from #{w_list['tsv_url']}"
      end
    end
  end
  
  # ==================================
  # = Private methods for UCSCClient =
  # ==================================
  
  private
  
  # gets the base URI for fetching information from UCSC based on our configuration
  def base_uri(which_base=nil)
    if which_base.nil?
      which_base = @ucsc_config['scrape_method'] == 'authoritative' ? 'authoritative' : 'local'
    end
    URI.parse(@ucsc_config['browser_hosts'][which_base] + @ucsc_config['browser_urls']['tracks'])
  end
  
  # gets the length of the genome
  def genome_size
    @genome_config['chr_order'].inject(0) {|result, chr| result + @genome_config['chr_lengths'][chr] }
  end
  
  # gets a list of available genome databases from UCSC, via the public downloads site
  def list_genomes
    data_urls = @ucsc_config['data_urls']
    uri = URI.parse(data_urls['all_genomes'])
    prefix = URI.parse(data_urls['chrom_info'].sub(/%s.*$/, '')).path
    doc = Nokogiri::HTML(uri.open)
    nk = doc.xpath("//a[starts-with(@href,'#{prefix}')][contains(@href,'#{data_urls['big_zips']}')]")
    nk.map {|a| a['href'][prefix.length..-1][/^[^\/]+/] }.uniq.sort
  end
  
  # gets the species and assembly date for a UCSC genome database name
  def get_species_and_date
    ret = {}
    uri = URI.parse(@ucsc_config['data_urls']['all_genomes'])
    doc = Nokogiri::HTML(uri.open)
    nk = doc.xpath("//font[contains(.,'(#{@genome})')]")
    if nk.size > 0
      ret['assembly_date'] = nk.first.text.sub(/\s+\(\w+\)$/, '')
      ret['species'] = nk.first.ancestors('table').first.previous_sibling.text.gsub(/^[^\x21-\x7E]+|\s+genome\s+$/i, '')
    end
    ret
  end
  
  # sorts a list of chromosomes based on a reasonable guess as to the numbering scheme
  def chr_sort(chrs)
    roman_chrs = chrs.find_all{ |chr| !!chr.sub(/^chr/, '').roman_to_i rescue false }
    is_roman = roman_chrs.size / chrs.size.to_f > 0.8  # this just a heuristic, but it works on sacCer, so...
    chrs.sort_by do |chr|
      chr = chr.sub(/^chr/, '')
      if is_roman
        chr.roman_to_i rescue chr[0] + 1e7
      elsif chr =~ /(\d+(\.\d+)?)$/
        $1.to_f
      else
        # all we got is some opaque letter like chrX
        # get its charcode and add it to a large number to put it at the end
        chr[0] + 1e7
      end
    end
  end
  
  # iterates over a list of sizes, skipping the ones that are not needed for the given bppp
  def each_size(sizes, bppp)
    sizes.each do |s|
      s = [s] unless s.is_a? Array
      next if s[1] and bppp > s[1]
      next if s[2] and bppp <= s[2]
      yield s[0]
    end
  end
  
  # sets a few standard things and generates a URI for a get request to UCSC
  def compose_uri(uri, opts, position)
    opts['db'] = @genome
    opts['textSize'] = @ucsc_config['text_size']
    opts['centerLabels'] = ''
    opts['nextExonArrows'] = ''
    opts['position'] = position
    uri.query = opts.to_query
    uri
  end
    
  # fetches an hgTracks page with ruby's open-uri and passes it to Nokogiri to be parsed as HTML
  def fetch_into_nokogiri(*args)
    uri = compose_uri(*args)
    if @ucsc_config['scrape_method'] == 'cgi_bin'
      Dir.mktmpdir do |dir|
        Dir.chdir(dir) do
          # get rid of HTTP headers before passing to Nokogiri
          doc = Nokogiri.parse(`#{@ucsc_config['cgi_bin_dir']}/hgTracks '#{uri.query}'`.sub(/(.*\n)*\n\n/, ''))
          yield doc, false
        end
      end
    else
      unless (limit = @ucsc_config['scrape_limit'][@ucsc_config['scrape_method']]).nil? || @last_fetch.nil?
        sleep [limit - (Time.now - @last_fetch), 0].max
      end
      @last_fetch = Time.now
      tries = 0
      doc = nil
      while doc.nil?
        begin
          doc = Nokogiri::HTML(uri.open)
        rescue StandardError
        rescue Timeout::Error => e
          raise e if (tries+=1) > @ucsc_config['max_fetch_tries']
        end
      end
      yield doc, true
    end
  end
  
  # locks a subdirectory that this process will work on using a lockfile and flock
  def lock_subdir(subdir, lock_state, end_at=nil)
    if lock_state
      if (@lock = File.new("#{subdir}/.lockfile#{end_at}", 'a+')).flock(File::LOCK_EX | File::LOCK_NB)
        FileUtils.touch subdir
        save_into_tch(subdir, :update_dirstat=>:only)
        true
      end
    elsif !@lock.nil?
      @lock.flock(File::LOCK_UN) && @lock.close
      File.delete(@lock.path)
    end
  end
  
  # The workhorse function that glues PNG images together and chunks tiles off the front
  def chunk_into_tiles(prev_file, new_file, bppp, size, tile_bp, get_map, subdir, temp_dir)
    if @optimized_chunking
      # We can use the compiled C extension
      new_file.map = prev_file.map.push(new_file.map, new_file.pix_data) if prev_file && get_map
      chunk_split(@tile_every, prev_file, new_file) do |chunk|
        dest = tile_dest(subdir, tile_bp, bppp)
        to_save = {dest => chunk}
        to_save["#{dest}.json"] = new_file.map.read!(@tile_every) if get_map
        save_into_tch(to_save)
        tile_bp += (@tile_every * bppp).to_i
      end
      prev_file.close! if prev_file
      prev_file = new_file
    else
      # We have to do the work with Ruby & ImageMagick
      # Montage the new image to the right edge of the previous image
      if not prev_file.nil?
        if not File.exists?(prev_file.path) then raise "#{prev_file.path} not found"; end
        new_file.map = prev_file.map.push(new_file.map, img_width(new_file.path)) if get_map
        montage_imgs([prev_file.path, new_file.path], new_file.path)
        prev_file.close!
      end
      prev_file = new_file
  
      # If the current image is larger than the @tile_every size, split it into tiles of the right size
      if @tile_every and (width = img_width(prev_file.path)) > @tile_every
        crop_img(prev_file.path, "#{temp_dir}/%d.png", "#{@tile_every}x", (width / @tile_every.to_f).ceil)
        tiled_files = Dir.glob("#{temp_dir}/*.png")
        end_tile_num = tiled_files.map{|f| /(\d+)\.png/.match(f)[1].to_i }.max
        (0...end_tile_num).each do |num|
          tile = "#{temp_dir}/#{num}.png"
          dest = tile_dest("#{@tile_db && "#{temp_dir}/"}#{subdir}", tile_bp, bppp)
          if size != 'dense' # crop tile to content_height
            crop_img(tile, dest, "x#{[img_content_height(tile), 1].max}+0+0")
            File.delete(tile)
          else File.rename(tile, dest); end
          prev_file.map.save!("#{dest}.json", @tile_every) if get_map
          save_into_tch(dest, :with_map=>get_map, :delete_file=>true, :from_pwd=>(@tile_db && temp_dir))
          tile_bp += (@tile_every * bppp).to_i
        end
        # crop remaining image to content_height
        end_tile = "#{temp_dir}/#{end_tile_num}.png"
        crop_img(end_tile, end_tile, "x#{[img_content_height(end_tile), 1].max}+0+0")          
        prev_file.close!
        prev_file.change_to end_tile
      end
    end
    [prev_file, tile_bp] # these must be passed back to the enclosing loop
  end
  
  # creates a 1px-high blank tile and returns the PNG contents
  def null_tile()
    return @null_tile if !@null_tile.nil?
    temp_file = InterimFile.new(false, ['ucsc','.png'])
    null_img(temp_file.path, "#{@genome_config['tile_every']}x1")
    @null_tile = temp_file.read
    temp_file.close!
    @null_tile
  end
  
  # starts a Tokyo Tyrant server, if necessary, to give us access to the Tokyo Cabinet tile database for this genome
  # returns a Rufus::Tokyo::Tyrant instance that is connected to this server
  def start_ttserver(tch_file)
    @tile_dbs = {} if @tile_dbs.nil?
    raise "This genome was configured to use Tokyo Tyrant but it cannot be started" if !TC_ENABLED
    if tch_file.is_a? Array
      # You've specified a host and port, so ttserver will be accessed over TCP/IP
      # In this case, the script cannot be responsible for starting the ttserver
      tile_db_sock = tch_file
    else
      tile_db_sock = "/tmp/#{tch_file.sub(/\.tch$/, '')}.sock"
      unless File.exists?(tile_db_sock) && File.stat(tile_db_sock).socket?
        if File.exists?(tile_db_sock) && !File.stat(tile_db_sock).socket?
          raise "Cannot start ttserver: another file present at #{tile_db_sock}"
        end
        full_tch_path = File.expand_path(tch_file, @init_pwd)
        system("ttserver -host #{shellescape tile_db_sock} -port 0 #{shellescape full_tch_path} 2>&1 >/dev/null &")
        sleep 0.5 until File.exists?(tile_db_sock)
        FileUtils.chmod 0777, tile_db_sock
      end
    end
    return @tile_dbs[tch_file] unless @tile_dbs[tch_file].nil?
    tile_db = @tile_dbs[tch_file] = Rufus::Tokyo::Tyrant.new(*tile_db_sock)
    tile_db['.null'] = null_tile if tile_db['.null'].nil?
    tile_db
  end
  
  # saves file(s) to Tokyo Cabinet via Tyrant, optionally with associated imagemap and/or deleting them afterward
  def save_into_tch(to_save, options={})
    o = {:with_map=>false, :delete_file=>false, :save_to=>nil, :update_dirstat=>:also, :from_pwd=>nil}.merge options
    to_save = o[:with_map] ? {to_save=>nil, "#{to_save}.json"=>nil} : {to_save=>nil} unless to_save.is_a?(Hash)
    if o[:save_to] && o[:save_to] != @genome_config['output_tch'] then tile_db = start_ttserver(o[:save_to])
    else tile_db = @tile_db; end
    return if tile_db.nil? # noop if tile_db is not open
    to_save.each do |fname, data|
      key = fname.sub(o[:from_pwd] ? /^#{Regexp.escape o[:from_pwd]}\/?/ : /^\.\//, '')
      unless o[:update_dirstat] == :only
        unless data
          File.open(fname, 'rb') {|f| data = f.read } 
          File.delete(fname) if o[:delete_file]
        end
        data = "-" if key[/\.png$/] && img_height(data) == 1
        tile_db[key] = data
      end
      tile_db[key.split('/')[0..1].join('/')] = {:ctime=>Time.new.to_i}.to_json if o[:update_dirstat]
    end
  end
  
  # determines the subdirectory where tiles should be spat out
  def tile_subdir(track, bppp, size='', create=true)
    subdir = "#{track}/#{'%2.2e' % bppp}#{'_' + size unless size.empty?}"
    FileUtils.mkdir_p(subdir) && FileUtils.chmod(0755, subdir) if create
    return subdir
  end
  
  # determines the final destination for a tile, and creates a subdirectory for it if needed
  def tile_dest(subdir, tile_bp, bppp, create=true)
    if bppp.to_f < @genome_config['subdir_for_bppps_under'] then
      subsubdir = "#{subdir}/#{('%010d'%tile_bp)[0..3]}"
      FileUtils.mkdir_p(subsubdir) && FileUtils.chmod(0755, subsubdir) if create
      return "#{subsubdir}/#{('%010d'%tile_bp)[4..10]}.png"
    end
    return "#{subdir}/#{'%010d'%tile_bp}.png"
  end

  # scans a genome's tiles to guess if certain tracks + sizes have a fixed height
  def add_fixed_heights(serve_tracks)
    no_fh_below = @genome_config['no_fh_below']
    serve_tracks.each do |t|
      puts "Scanning tiles for track #{t['n']}..."
      fh = {}
      trk = t['n']=='ruler' ? 'ideograms' : t['n']
      if t['n']=='ruler' && @genome_config['chr_bands'].nil?
        @genome_config['bppps'].each{|bppp| fh['%2.2e' % bppp] = {"dense"=>10} }
      else
        @genome_config['bppps'].each do |bppp|
          next if no_fh_below && bppp <= no_fh_below
          bppp_formatted = '%2.2e' % bppp
          each_size(t['s'], bppp) do |size|
            next if (t['no_fh'] || []).find {|s| s = Array(s); s[0] == size && (!s[1] || bppp <= s[1]) }
            # if the first 20 tiles for this track are all the same height,
            # it's almost certainly not a variable-height track: set a fixed height
            heights = (1..genome_size).step(bppp * @tile_every).first(20).map do |bp|
              dest = tile_dest(tile_subdir(trk, bppp, size, false), bp, bppp, false)
              full_path = File.expand_path(dest, @genome_config['output_dir'])
              png = @tile_db && @tile_db[dest]
              png ? img_height(png) : (File.exists?(full_path) ? img_height(full_path) : nil)
            end
            heights.compact!
            if heights.uniq.size == 1 and heights.first > 1 then 
              fh[bppp_formatted] ||= {}
              fh[bppp_formatted][size || 'dense'] = heights.first
            end
          end
        end
      end
      t['fh'] = fh
    end
  end
  
end
