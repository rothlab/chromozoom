require 'uri'

# prefer the syck YAML engine, although it is not available on rubies >= 2.0
begin YAML::ENGINE.yamler = 'syck'; rescue ArgumentError; end

class Numeric
  # Turns a number of seconds into a human-readable duration
  def duration
    return "unknown" if self.is_a?(Float) && !self.finite?
    secs  = self.to_int
    mins  = secs / 60
    hours = mins / 60
    days  = hours / 24

    if days > 0
      "#{days}d #{hours % 24}h"
    elsif hours > 0
      "#{hours}h #{mins % 60}m"
    elsif mins > 0
      "#{mins}m #{secs % 60}s"
    elsif secs >= 0
      "#{secs}s"
    end
  end
  
  # Outputs a string representation of a number with commas for readability
  def commify
   (s = to_i.to_s; x = s.length; s).rjust(x + (3 - (x % 3))).scan(/.{3}/).join(',').sub(/^[\s,]+/, '')
  end
end

# Converts roman numerals into decimal; from http://www.ruby-forum.com/topic/195594
class String
  def roman_to_i
    str = self.downcase
    raise RangeError, "Not a roman numeral" unless str =~ /^[mdclxvi]+$/
    raise RangeError, "Not a roman numeral" if %w{iiii vv xxxx ll cccc dd}.any? { |x| str.include?(x) }
    str.tr!("ivxlcdm", "0123456")  # translate into numbers
    level, last, deviated, ret = 7, 0, false, 0
    table = [1,5,10,50,100,500,1000]  # the translation table
    str.each_char do |char|
        num = char.to_i
        if num > level  # means a deviation
          raise RangeError, "Not a roman numeral" if deviated or not  # no double deviation
            %w{01 02 23 24 45 46}.include?("#{last}#{num}") # only allowed deviations
          ret -= table[last]*2 # remedy deviation
          level = last-1 # don't allow IXI or IXV etc.
          deviated = true
        else
          deviated = false
          level = num  # don't allow MLM etc.
        end
      ret += table[num]
      last = num
    end
    ret
  end
end

# Turns a hash of params=>values (values can be arrays, which repeats the param)
# into a query string for a URI
class Hash
  def to_query
    map do |name,values|
      values = [''] if values === ''
      Array(values).map do |value| "#{URI.escape name.to_s}=#{URI.escape value.to_s}"; end
    end.flatten.join("&")
  end
end

# Some hax to make things print in YAML better.
# E.g., print small hashes and arrays inline.
class Hash
  attr_accessor :yaml_key_order
  def to_yaml_style; self.size < 6 && self.values.map{|x| x.size || 0 }.max < 30 ? :inline : super; end
  # Replacing the to_yaml function so it'll serialize hashes sorted (by their keys)
  # with any keys found in @yaml_key_order pinned to the top and sorted by their order in that array.
  # Original function is in /usr/lib/ruby/1.8/yaml/rubytypes.rb
  if YAML::ENGINE.yamler =='syck' then
    def to_yaml( opts = {} )
      @yaml_key_order ||= []
      YAML::quick_emit( object_id, opts ) do |out|
        out.map( taguri, to_yaml_style ) do |map|
          sorted = sort do |a,b|
            a_index = @yaml_key_order.index a[0]
            b_index = @yaml_key_order.index b[0]
            if a_index && b_index then a_index<=>b_index
            elsif a_index && !b_index then -1
            elsif b_index && !a_index then 1
            else a[0]<=>b[0] ; end
          end
          sorted.each do |k, v|
            map.add( k, v )
          end
        end
      end
    end
  end
end
class Array
  def to_yaml_style; self.size < 6 ? :inline : super; end
end