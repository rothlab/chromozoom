#!/usr/bin/env python
"""This module contains parsers for data structures written in the `autoSql`_
object specification language, used by the `UCSC genome browser`_, `BigBed`_ files
and `BigWig`_ files.

This module was copied and modified from the `plastid` software project:
http://plastid.readthedocs.io/en/latest/

The `plastid` library is released and reused here under the 3-clause BSD license.
See autosql.LICENSE.txt for the full text of the license.

.. contents::
   :local:
   
   
Summary
-------

Parsers are constructed by initializing an |AutoSqlDeclaration| with a block of
`autoSql`_ text::

    >>> declaration = '''table easy_table
    "A table with a comment on the next line" 
        (
        uint number auto; "a number with a token"
        uint [3] points ; "r,g,b values"
        lstring  my_string ; "a long string"
        uint a_field_size ; "the size for the next field"
        float [a_field_size] float_array ; "an array of floats"
        set(a,b,c) alpha ; "the first three letters of the alphabet"
        )
    '''
    >>> record_parser = AutoSqlDeclaration(declaration)


The parser that is created can then be called to parse text records into dictionaries::

    >>> record_parser("3    1,2,3    my string with spaces    5    1.1,1.2,1.3,1.4,1.5    a,b")
    OrderedDict([("number",3),
                 ("points",(1,2,3)),
                 ("my_string","my string with spaces"),
                 ("a_field_size",5),
                 ("float_array",(1.1,1.2,1.3,1.4,1.5)),
                 ("alpha",{'a','b'}]))

Module contents
---------------
|AutoSqlDeclaration|
    Parses `autoSql`_ declarations for `table`, `simple`, and `object`
    declaration types. Delegates parsing of individual fields to appropriate subclasses 
    (e.g. |AutoSqlField|, |SizedAutoSqlField|, and |ValuesAutoSqlField|).

|AutoSqlField|, |SizedAutoSqlField|, |ValuesAutoSqlField|
    Parse various sorts of fields within an autoSql declaration block


Notes
-----
 #. These parsers seek only to provide Python bindings for `autoSql`_ declarations.
    They do **NOT** generate C or SQL code from `autoSql`_, as those functions
    are already provided by `Jim Kent's utilities <https://github.com/ENCODE-DCC/kentUtils/tree/master/>`_

 #. ``set`` and ``enum`` field types are parsed as ``sets`` of strings

 #. ``primary``, ``index``, and ``auto`` `autoSQL`_ tags are accepted in line declarations,
    but are ignored because they are not relevant for parsing

 #. The parsers assume that they will be parsing tab-delimited text blocks
  
 #. Although declarations are routinely nested as fields within other
    declarations in C ``struct`` s and in SQL databases, in the absence of a standard,
    it is unclear how these would be serialized within tab-delimited columns of `BigBed`_
    files. Therefore, nested declarations are not supported..


See Also
--------
`Updated autoSql Grammar specification 
    <https://github.com/ENCODE-DCC/kentUtils/blob/36d6274459f644d5400843b8fa097b380b8f7867/src/hg/autoSql/autoSql.doc>`_
    Explanation of autoSql grammar

NOTE that newer kentsrc code adds additional types for the 64-bit era, notably bigint and double

`The ENCODE project's tests for autoSql parsers <https://github.com/ENCODE-DCC/kentUtils/tree/master/src/hg/autoSql/tests/input>`_
    Official autoSql unit tests

`Kent & Brumbaugh, 2002 <http://www.linuxjournal.com/article/5949>`_
    First publication of autoSql & autoXml 

"""
import re
from collections import OrderedDict
from abc import abstractmethod
import sys

# regular expressions that recognize various autoSql elements
_pattern_bits = { "start"   : r"^\s*",
                  "type"    : r"(?P<type>\w+)",
                  "name"    : r"\s+(?P<name>\w+)\s*",
                  "semi"    : r"\s*;\s*",
                  # Quoted strings are modified from the "standard" to **always** terminate at newlines.
                  "comment" : r"\"(?P<comment>[^\"\n]*)[\"\n]",  
                  "size"    : r"\s*\[\s*(?P<size>\w+)\s*\]\s*",
                  "values"  : r"\s*\(\s*(?P<value_names>[^()]+)\s*\)\s*",
                  "optionals" : r"(?P<opt1>\s+primary|\s+auto|\s+index\s*(\[\s*\d+\s*\])?)?\s*(?P<opt2>"
                                r"\s+primary|\s+auto|\s+index\s*(\[\s*\d+\s*\])?)?\s*(?P<opt3>"
                                r"\s+primary|\s+auto|\s+index\s*(\[\s*\d+\s*\])?)?", 
                  "declare_type_name" : r"(?P<declare_type>object|simple|table)\s+(?P<declare_name>\w+)\s+",
                  "field_text" :  r"\s*\(\s*(?P<field_text>.*)\)",
                 }


class AutoSqlParseError(Exception):
    pass


class AbstractAutoSqlElement(object):
    """Abstract base class for parsers of autoSql elements
    
    Attributes
    ----------
    attr : dict
        Dictionary of attributes describing the element (e.g. *name,* *type,* et c) 
        
    autosql : str
        Block of autoSql text specifying format of element
        
    match_pattern : :py:class:`re.RegexObject`
        Pattern that determines whether or not a block of autoSql matches this object
    
    parent : instance of subclass of |AbstractAutoSqlElement|, or None
        Parent / enclosing element
    
    field_types : dict
        Dictionary matching type names (as strings) to formatters that parse them
        from plaintext
    
    delim : str, optional
        Text delimiter for fields in blocks called by :py:meth:~__call__~
        (Default: "\t")
    """
    match_str = ""
    match_pattern = re.compile(match_str, flags=re.IGNORECASE)
     
    def __init__(self,autosql,parent=None,delim="\t"):
        self.autosql = autosql
        self.parent  = parent
        self.delim   = delim
        self.field_types = { "int"    : (int,    "i"), #32-bit
                             "uint"   : (int,    "I"), #32-bit
                             "short"  : (int,    "h"), #16-bit
                             "ushort" : (int,    "H"), #16-bit
                             "byte"   : (int,    "b"), #8-bit
                             "ubyte"  : (int,    "B"), #8-bit
                             "bigint" : (int,    "q"), #64-bit (not in the original spec)
                             "float"  : (float,  "f"), #single-precision
                             "double" : (float,  "d"), #double-precision (not in the original spec)
                             "char"   : (str,    "c"), #8-bit
                             "string" : (str,    "s"), #variable up to 255bytes
                             "lstring": (str,    "s"), #variable up to 2billion bytes
                           }
        self.attr = self.match_pattern.search(autosql).groupdict()
    
    def __repr__(self):
        return "<%s name=%s type=%s>" % (self.__class__.__name__,
                                         self.attr["name"],
                                         self.attr.get("type",self.__class__.__name__))
    
    def add_type(self,name,formatter):
        """Add a type to the parser
        
        Parameters
        ----------
        name : str
            Name of data type
        
        formatter : callable
            Function/callable that, when applied to autoSql text, yields
            an object of the type specified by ``name``
        """
        self.field_types[name] = formatter
        
    @abstractmethod
    def __call__(self,text,rec=None):
        """Parse an OrderedDict matching ``self.autosql`` from a block of delimited text
        
        Parameters
        ----------
        text : str
            Multiline text block, formatted in autoSql
        
        rec : OrderedDict or None, optional
            Record whose attributes are being populated by recursive
            processing of ``text``. Passed in cases where fields sized by variables
            need to look up instance values of earlier fields to evaluate those
            variables.
        """
        pass
    
    @staticmethod
    def mask_comments(text):
        """Mask all comments in an autoSql block in order to facilitate parsing
        by regular expressions
        
        Parameters
        ----------
        text : str
            autoSql-formatted text
        
        Returns
        -------
        str
            Text with comments replaced by "xxxxxx" of same length
        
        list
            List of (comment.start,comment.end), including quotes, for each comment
            in ``text`` 
        """
        # Modified from the original to always terminate quoted strings at a newline.
        cpat = re.compile(r"\"[^\"\n]+[\"\n]", flags=re.IGNORECASE)
        match_locs = []
        for match in cpat.finditer(text):
            my_start = match.start()
            my_end   = match.end()
            match_len = my_end - my_start
            match_locs.append((my_start+1,my_end-1))
            text = text[:my_start+1] + "x"*(match_len-2) + text[my_end-1:]
        
        return text, match_locs

    @classmethod
    def matches(cls,text):
        """Determine whether autoSql formatting text matches this autoSql element
        
        Parameters
        ----------
        text : str
            Block of autoSql-formatted declaration text
        
        Returns
        bool
            True an autoSql parser of this class's type can be made from this
            specification, otherwise False
        """
        return cls.match_pattern.search(text) is not None


class AutoSqlDeclaration(AbstractAutoSqlElement):
    """Parser factory that converts delimited text blocks into OrderedDicts,
    following the field names and types described by an autoSql declaration element

    Parameters
    ----------
    autosql : str
        Block of autoSql text specifying format of element
        
    parent : instance of subclass of |AbstractAutoSqlObject| or `None`, optional
        Parent / enclosing element. Default: None
    
    delim : str, optional
        Field delimiter (default: tab)    
    
    
    Attributes
    ----------
    attr : dict
        Dictionary of descriptive attributes (e.g. *name,* *type,* *declare_type,* et c) 
    
    field_formatters : OrderedDict
        Dictionary mapping field names to type names

    field_comments : OrderedDict
        Dictionary mapping field names to comments
        
    field_types : dict
        Dictionary matching type names (as strings) to formatters that parse them
        from plaintext
    
    autosql : str
        Block of autoSql text specifying format of element
        
    match_pattern : :py:class:`re.RegexObject`
        Pattern that determines whether or not a block of autoSql matches this object
    
    parent : instance of subclass of |AbstractAutoSqlObject|, or None
        Parent / enclosing element. Default: None
    
    delim : str, optional
        Text delimiter for fields in blocks called by :py:meth:~__call__~
        (Default: "\t")
    
    
    Methods
    -------
    :py:meth:`AutoSqlDeclaration.__call__`
        Parse autoSql-formatted blocks of text according to this declaration
    """
    
    match_str  = r"".join([_pattern_bits[_X] for _X in ("start","declare_type_name","comment","field_text")])
    match_pattern = re.compile(match_str, re.DOTALL | re.IGNORECASE)

    def __init__(self,autosql,parent=None,delim="\n"):
        """Create an |AutoSqlDeclaration|
        
        Parameters
        ----------
        autosql : str
            Block of autoSql text specifying format of element
            
        parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
            Parent / enclosing element. Default: None
        
        delim : str, optional
            Field delimiter (default: tab)
        """
        AbstractAutoSqlElement.__init__(self,autosql,parent=parent,delim="\t")
        
        # re-do regex match masking out comments, in case the comments
        # contain special characters that would mess up the parsing
        masked_sql, comment_match_locs = self.mask_comments(autosql)
        match_dict = self.match_pattern.search(masked_sql).groupdict()

        self.attr["declare_type"] = match_dict["declare_type"]
        self.attr["name"]         = match_dict["declare_name"]
        masked_field_text = match_dict["field_text"]

        self.attr["comment"] = autosql[comment_match_locs[0][0]:comment_match_locs[0][1]].strip("\n").strip("\"")
        field_text_start = masked_sql.index(masked_field_text)
        self._field_text  = autosql[field_text_start:field_text_start+len(masked_field_text)]
        
        if self.parent is not None:
            self.parent.add_type(self.attr["declare_name"],self)
            
        self.field_formatters = OrderedDict()
        self.field_comments   = OrderedDict()
        self._parse_fields()

    def _parse_fields(self):
        """Parse fields of an autoSql declaration, and populate
        ``self.field_formatters`` and ``self.field_comments``.
        """
        # order in which we try to match autoSql fields        
        match_order = [AutoSqlField,SizedAutoSqlField,ValuesAutoSqlField]

        # fields are area of string from last starting point to end of comment
        # first starting point is 0;all subsequent starting points will be end 
        # of previous comment
        
        _, comment_locs = self.mask_comments(self._field_text)
        last_index = 0
        for (_,next_index) in comment_locs:
            field_str = self._field_text[last_index:next_index+1]
            for field_class in match_order:
                if field_class.matches(field_str):
                    my_parser = field_class(field_str)
                    name      = my_parser.attr["name"]
                    if name in self.field_formatters:
                        oldname = name
                        i = 1
                        current_formatter = self.field_formatters[name]
                        current_type = current_formatter.attr.get("type",current_formatter.__class__.__name__) 
                        new_type = my_parser.attr.get("type",my_parser.__class__.__name__) 
                        while name in self.field_formatters:
                            i += 1
                            name = "%s%s" % (oldname,i)
                            raise AutoSqlParseError("Element named '%s' of type '%s' already found in autoSql declaration '%s.'"
                                 " Renaming current element of type '%s' to '%s'" % (oldname,
                                                                                     current_type,
                                                                                     self.attr.get("name","unnamed declaration"),
                                                                                     new_type,
                                                                                     name))
                        my_parser.attr["name"] = name
                        
                    self.field_formatters[name]  = my_parser
                    self.field_comments[  name]  = my_parser.attr["comment"]
            
            last_index = next_index+1

    def __repr__(self):
        return "<%s name=%s type=%s fields=[%s]>" % (self.__class__.__name__,
                                         self.attr["name"],
                                         self.attr.get("type",self.__class__.__name__),
                                         ",".join(self.field_formatters.keys()))
        
    def __call__(self,text,rec=None):
        """Parse an OrderedDict matching ``self.autosql`` from a block of delimited text
        
        Parameters
        ----------
        text : str
            Multiline text block, formatted in autoSql

        rec : OrderedDict or None, optional
            Record whose attributes are being populated by recursive
            processing of ``text``. Passed in cases where fields sized by variables
            need to look up instance values of earlier fields to evaluate those
            variables.
        
        Returns
        -------
        OrderedDict
            Dictionary mapping field names to their values
        """
        items = text.split(self.delim)
        rec = OrderedDict() if rec is None else rec
        obj = OrderedDict()
        for item, (field_name,formatter) in zip(items,self.field_formatters.items()):
            obj[field_name] = formatter(item,rec=obj)
        
        return obj

class AutoSqlField(AbstractAutoSqlElement):
    """Parser factory for autoSql fields of type ``fieldType fieldName ';' comment``

        
    Parameters
    ----------
    autosql : str
        Block of autoSql text specifying format of element
        
    parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
        Parent / enclosing element. Default: None
    
    delim : str, optional
        Field delimiter (default: tab)
        
    
    Attributes
    ----------
    attr : dict
        Dictionary of descriptive attributes (e.g. name, type, et c) 

    formatter : callable
        Callable/function that converts plain text into an object of the correct type
        
    autosql : str
        Block of autoSql text specifying format of element
        
    match_pattern : :class:`re.RegexObject`
        Pattern that determines whether or not a block of autoSql matches this object
    
    parent : instance of subclass of :class:`AbstractAutoSqlObject` or `None`
        Parent / enclosing element (Default: None)
    
    delim : str, optional
        Text delimiter for fields in blocks called by :meth:`__call__`
        (Default: newline)
    """
    match_str = r"".join([_pattern_bits[_X] for _X in ("start","type","name","optionals","semi","comment")])
    match_pattern = re.compile(match_str, flags=re.IGNORECASE)

    def __init__(self,autosql,parent=None,delim=""):
        """Create an |AutoSqlField|
        
        Parameters
        ----------
        autosql : str
            Block of autoSql text specifying format of element
            
        parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
            Parent / enclosing element. Default: None
        
        delim : str, optional
            Field delimiter (default: tab)
        """        
        AbstractAutoSqlElement.__init__(self,autosql,parent=parent,delim=delim)
        type_ = self.attr["type"]
        try:
            self.formatter = self.field_types[type_][0]
        except KeyError:
            try:
                self.formatter = self.parent.field_types[type_][0]
            except:
                self.formatter = str
                raise AutoSqlParseError("Could not find formatter for field '%s' of type '%s'. "
                                        "Casting to 'string' instead." % (self.attr["name"],type_))
    
    def __call__(self,text,rec=None):
        """Parse an value matching the field described by ``self.autosql``
        from a block of delimited text
        
        Parameters
        ----------
        text : str
            Multiline text block, formatted in autoSql
        
        Returns
        -------
        Value or object of appropriate type
        """
        try:
            return self.formatter(text)
        except ValueError:
            message = ("Could not convert autoSql value '%s' for field '%s' to type '%s'. "
                       "Casting to 'string' instead. " % (text, self.attr["name"], self.formatter.__name__))
            raise AutoSqlParseError(message) 
            return text


class SizedAutoSqlField(AutoSqlField):
    """Parser factory for autoSql fields of type ``fieldType `[` fieldSize `]` fieldName ';' comment``

        
    Parameters
    ----------
    autosql : str
        Block of autoSql text specifying format of element
        
    parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
        Parent / enclosing element. Default: None
    
    delim : str, optional
        Field delimiter (default: tab)


    Attributes
    ----------
    attr : dict
        Dictionary of descriptive attributes (e.g. *name*, *size,* *type,* et c) 

    formatter : callable
        Callable/function that converts plain text into an object of the correct type
        
    autosql : str
        Block of autoSql text specifying format of element
        
    match_pattern : :class:`re.RegexObject`
        Pattern that determines whether or not a block of autoSql matches this object
    
    parent : instance of subclass of :class:`AbstractAutoSqlObject` or `None`
        Parent / enclosing element (Default: None)
    
    delim : str, optional
        Text delimiter for fields in blocks called by :meth:`__call__`
        (Default: newline)

    Methods
    -------
    :py:meth:`SizedAutoSqlField.__call__`
        Parse autoSql-formatted blocks of text into the tuples of the object type
        specified by this field  
    """    
    match_str = r"".join([_pattern_bits[_X] for _X in ("start","type","size","name","optionals","semi","comment")])
    match_pattern = re.compile(match_str, flags=re.IGNORECASE)

    def __init__(self,autosql,size=1,parent=None,delim=","):
        """Create a |SizedAutoSqlField|
        
        Parameters
        ----------
        autosql : str
            Block of autoSql text specifying format of element
            
        parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
            Parent / enclosing element. Default: None
        
        delim : str, optional
            Field delimiter (default: tab)
        """           
        AutoSqlField.__init__(self,autosql,parent=parent,delim=delim)
        try:
            self.attr["size"] = int(self.attr["size"])
            self.attr["size_is_int"] = True
        except ValueError:
            self.attr["size_is_int"] = False
    
    def __call__(self,text,rec=None):
        """Parse an value matching the field described by ``self.autosql``
        from a block of delimited text
        
        Parameters
        ----------
        text : str
            Multiline text block, formatted in autoSql

        rec : OrderedDict or None, optional
            Record whose attributes are being populated by recursive
            processing of ``text``. Passed in cases where fields sized by variables
            need to look up instance values of earlier fields to evaluate those
            variables.
        
        Returns
        -------
        tuple
            Tuple of appropriate type
        """
        if self.formatter != str:
            try:
                retval = tuple([self.formatter(X) for X in text.strip().strip(self.delim).split(self.delim)])
            except ValueError:
                message = ("Could not convert autoSql value '%s' in field '%s' to tuple of type '%s'."
                           " Leaving as str " % (text, self.attr["name"], self.formatter.__name__))
                raise AutoSqlParseError(message) 
                return text
        else:
            retval = text
        
        if self.attr["size_is_int"] == True:    
            assert len(retval) == self.attr["size"]
        else:
            assert len(retval) == rec[self.attr["size"]]
        
        return retval


# for set, enum types
class ValuesAutoSqlField(AbstractAutoSqlElement):
    """Parser factory for autoSql fields of type ``fieldType `(` fieldValues `)` fieldName ';' comment``
    where ``fieldType`` would typically be ``set`` or ``enum``
    
        
    Parameters
    ----------
    autosql : str
        Block of autoSql text specifying format of element
        
    parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
        Parent / enclosing element. Default: None
    
    delim : str, optional
        Field delimiter (default: tab)    
    """
    
    match_str = r"".join([_pattern_bits[_X] for _X in ("start","type","values","name","optionals","semi","comment")])
    match_pattern = re.compile(match_str, flags=re.IGNORECASE)
    
    def __init__(self,autosql,parent=None,delim=","):
        """Create a |ValuesAutoSqlField|
        
        Parameters
        ----------
        autosql : str
            Block of autoSql text specifying format of element
            
        parent : instance of subclass of |AbstractAutoSqlObject| or None, optional
            Parent / enclosing element. Default: None
        
        delim : str, optional
            Field delimiter (default: tab)
        """            
        AbstractAutoSqlElement.__init__(self,autosql,parent=parent,delim=delim)
        self.attr["value_names"] = [X.strip() for X in self.attr["value_names"].split(",")]

    def __call__(self,text,rec=None):
        """Parse an value matching the field described by ``self.autosql``
        from a block of delimited text
        
        Parameters
        ----------
        text : str
            Multiline text block, formatted in autoSql

        rec : OrderedDict or None, optional
            Record whose attributes are being populated by recursive
            processing of ``text``. Passed in cases where fields sized by variables
            need to look up instance values of earlier fields to evaluate those
            variables.
        
        Returns
        -------
        set
            set of items found in column 
        """
        items = set([X.strip() for X in text.strip(self.delim).split(self.delim) if len(X.strip()) > 0])
        return items