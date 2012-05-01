/*
  png_fifo_chunker
  
  Stitches PNG images together horizontally, chunking them by chunk_width pixels
  
  Can be compiled as a standalone executable or as a Ruby extension.
  
  Built to speed up the inner loop in ucsc_stitch.rb.
*/

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include "lodepng.h"

#ifndef STANDALONE
#include "ruby.h"
#endif

#define ERR_LODEPNG 1
#define ERR_NOT_ENOUGH_INFILES 2
#define ERR_NOT_ENOUGH_ARGS 3
#define ERR_CHUNK_WIDTH 4

typedef unsigned char uchar;

typedef struct {
  unsigned int x_offset;
  unsigned int width;
} xrange;

typedef struct {
  uchar* data;
  size_t size;
} buffer;

typedef struct {
  buffer buf;
  int w;
  int h;
} image;

#ifdef CREATE_FILES
int file_exists(const char* filename) {
  FILE* file;
  if (file = fopen(filename, "r")) {
    fclose(file);
    return 1;
  }
  return 0;
}
#endif

/* Glues the `num_inputs` images in `inputs` together horizontally, placing
   the image data in `out` */
int montage_pieces(image* out, int num_inputs, image inputs[], xrange crops[]) {
  int out_offset = 0, 
    in_offset, row_size, copy_px, copy_size, i, j, x, y;
  
  /* height of the montaged image is the maximum of the heights */
  out->w = 0;
  out->h = 0;
  for (i = 0; i < num_inputs; i++) {
    out->w += crops[i].width ? crops[i].width : inputs[i].w;
    if (inputs[i].h > out->h) { out->h = inputs[i].h; }
  }
  
  out->buf.size = sizeof(uchar) * 4 * out->w * out->h;
  out->buf.data = (uchar*) malloc(out->buf.size);
    
  for (i = 0; i < num_inputs; i++) {
    copy_px = crops[i].width ? crops[i].width : inputs[i].w;
    row_size = inputs[i].w * 4;
    copy_size = copy_px * 4;
    in_offset = crops[i].x_offset * 4;
    for (j = 0; j < inputs[i].h; j++) {
      memcpy(out->buf.data + (out_offset + j * out->w) * 4, inputs[i].buf.data + j * row_size + in_offset, copy_size);
    }
    /* Ensure that uncopied rows are set to 0x00 */
    for (j = inputs[i].h; j < out->h; j++) {
      memset(out->buf.data + (out_offset + j * out->w) * 4, '\0', copy_size);
    }
    out_offset += copy_px;
  }
}

/* Find lowest non-transparent pixel in the image, 
   searching only the columns between `left_px` and `left_px` + `width` */
int content_height(image* img, int left_px, int width) {
  int row_size = img->w * 4,
    offset = left_px * 4,
    height = 1, 
    i, j;
  for (i = img->h - 1; i > 0 && height == 1; i--) {
    for (j = 0; j < width; j++) {
      /* 4th byte of each pixel represents the alpha value */
      if (img->buf.data[i * row_size + offset + j * 4 + 3] > 0) { height = i + 1; break; }
    }
  }
  return height;
}

/* Extracts a portion of the `from` image into the `to` image
   starting at x=`left_px`, y=0 and with dimensions `to->w` by `to->h` */
int extract(image* from, image* to, int left_px) {
  int from_row_size = from->w * 4, 
    to_row_size = to->w * 4,
    offset = left_px * 4,
    i;
  to->buf.size = sizeof(uchar) * 4 * to->w * to->h;
  to->buf.data = (uchar*) malloc(to->buf.size);
  for (i = 0; i < to->h; i++) {
    memcpy(to->buf.data + i * to_row_size, from->buf.data + i * from_row_size + offset, to_row_size);
  }
}

/* Splits the image in `img` into chunks that are `chunk_width` pixels wide,
   encoding them as PNGs into the `outs` array, and then placing the leftover pixels at the
   right end of the image back into `img` */
int chunk_split(int chunk_width, image* img, buffer** outs) {
  int num_outs, left_px, i, j, k;
  image chunk;
  LodePNG_Encoder encoder;
  
  chunk.w = chunk_width;
  num_outs = (img->w - 1) / chunk_width; /* always reserve >=1px column from the original */
  
  /* allocate memory for the expected number of chunk images */
  *outs = (buffer*) malloc(num_outs * sizeof(buffer));
  
  /* extract chunk images, encode them into PNGs, and place them into the outs array */
  for (i = 0; i < num_outs; i++) {
    left_px = i * chunk.w;
    chunk.h = content_height(img, left_px, chunk.w);
    
    if (chunk.h > 1) {
      extract(img, &chunk, left_px); /* mallocs chunk.buf.data */
      LodePNG_Encoder_init(&encoder);
      LodePNG_Encoder_encode(&encoder, &(*outs)[i].data, &(*outs)[i].size, chunk.buf.data, chunk.w, chunk.h);
      LodePNG_Encoder_cleanup(&encoder);
      free(chunk.buf.data);
      chunk.buf.size = 0;
    } else {
      (*outs)[i].data = (uchar*) malloc(1 * sizeof(uchar));
      (*outs)[i].data[0] = '-';
      (*outs)[i].size = 1;
    }
  }
  
  /* place leftovers into the original img */
  left_px = num_outs * chunk_width;
  chunk.w = img->w - left_px;
  chunk.h = content_height(img, left_px, chunk.w);
  extract(img, &chunk, left_px); /* mallocs chunk.buf.data */
  free(img->buf.data);  /* free original img's buf data */
  img->w = chunk.w;
  img->h = chunk.h;
  img->buf = chunk.buf; /* original img's buf now points at the chunk we just extracted */
  
  return num_outs;
}

/* Montages the images contained in the `num_infiles` PNG files named in `infiles`, then
   chunks them into tiles of `chunk_width` pixels, outputting the PNG data for the tiles into `outs`
   and saving the remainder of the image back into the last file in `infiles`  */
int montage_and_chunk(int chunk_width, char* infiles[], int num_infiles, xrange crops[], buffer** outs) {
  if (num_infiles < 1) { return -ERR_NOT_ENOUGH_INFILES; }

  buffer buf = {.data = NULL, .size = 0};
  image montaged = {.buf = {.data = NULL, .size = 0}, .w = 0, .h = 0};
  image inputs[num_infiles];
  int ret = -ERR_LODEPNG, i;
  LodePNG_Decoder decoder;
  LodePNG_Encoder encoder;  
  
  /* ensures calling free on these pointers is always OK */
  for (i = 0; i < num_infiles; i++) { inputs[i].buf.data = NULL; } 
  
  /* load and decode the input files into the `inputs` array */
  for (i = 0; i < num_infiles; i++) {
    LodePNG_loadFile(&buf.data, &buf.size, infiles[i]); 
    LodePNG_Decoder_init(&decoder);
    LodePNG_Decoder_decode(&decoder, &inputs[i].buf.data, &inputs[i].buf.size, buf.data, buf.size);
    
    if (decoder.error) {
      fprintf(stderr, "error %u: %s\n", decoder.error, LodePNG_error_text(decoder.error));
      goto CLEANUP_montage_and_chunk;
    }
    inputs[i].w = decoder.infoPng.width;
    inputs[i].h = decoder.infoPng.height;
    LodePNG_Decoder_cleanup(&decoder);
    free(buf.data);
    buf.data = NULL;
    buf.size = 0;
  }
  
  /* montage pieces of the inputs into `montaged`, then chunk_split them into `outs` */
  montage_pieces(&montaged, num_infiles, inputs, crops);
  ret = chunk_split(chunk_width, &montaged, outs);
  
  /* encode leftovers and save into last input file */
  LodePNG_Encoder_init(&encoder);
  LodePNG_Encoder_encode(&encoder, &buf.data, &buf.size, montaged.buf.data, montaged.w, montaged.h);
  LodePNG_saveFile(buf.data, buf.size, infiles[num_infiles - 1]);
  LodePNG_Encoder_cleanup(&encoder);
  
  /* cleanup allocated memory */
  CLEANUP_montage_and_chunk:
  if (decoder.error) { LodePNG_Decoder_cleanup(&decoder); }
  for (i = 0; i < num_infiles; i++) { free(inputs[i].buf.data); }
  free(buf.data);
  free(montaged.buf.data);
  return ret;
}

/* ////////////////////////////////////////////////////////////////////////// */
/* //              For compilation as a standalone executable              // */
/* ////////////////////////////////////////////////////////////////////////// */

#ifdef STANDALONE
void usage(const char* cmd, const char* error) {
  if (error[0] != '\0') { 
    fprintf(stderr, "error: %s\n", error);
  }
  fprintf(stderr, "Usage:\n  %s chunk_width png_1 [x_offset,width] [png_2 [x_offset,width] ...]\n", cmd);
}

bool parse_xrange(char* arg, xrange* to) {
  int i = 0, offset = -1;
  char c;
  while ((c = arg[i++]) != '\0') {
    if (c == ',') { 
      if (offset != -1) { return false; } /* can only have one comma */
      offset = i;
      arg[i - 1] = '\0'; /* null-terminate the first number */
    } else if (c < '0' || c > '9') { return false; } /* only digits and comma allowed */
  }
  if ( offset == -1 ) { return false; } /* must have one comma */
  to->x_offset = atoi(arg);
  to->width = atoi(arg + offset);
  return true;
}

int main(int argc, char* argv[]) {
  int ret = 0, num_infiles = 0, chunk_width, num_outputs, i, j;
  buffer* outputs = NULL;
  char** infiles;
  xrange* crops;
  xrange zeroed = {0};
  
  if (argc < 3) {
    usage(argv[0], "not enough arguments");
    return ERR_NOT_ENOUGH_ARGS;
  }
  chunk_width = atoi(argv[1]);
  if (chunk_width <= 0) {
    usage(argv[0], "chunk_width should be an integer > 0");
    return ERR_CHUNK_WIDTH;
  }
  infiles = (char**) malloc(sizeof(char*) * (argc - 2));
  crops = (xrange*) malloc(sizeof(xrange) * (argc - 2));
  for (i = 2; i < argc; i++) {
    crops[i - 2] = zeroed;
    if (!num_infiles || !parse_xrange(argv[i], &crops[num_infiles - 1])) { infiles[num_infiles++] = argv[i]; }
  }
  
  /* mallocs outputs and outputs[].data */
  num_outputs = montage_and_chunk(chunk_width, infiles, num_infiles, crops, &outputs); 
  if (num_outputs < 0) { ret = -num_outputs; goto ERROR_main; }
  
  for (i = 0; i < num_outputs; i++) {
#ifdef CREATE_FILES
    FILE *fp;
    char fname[1000];
    sprintf(fname, "out.%d.png", i + 1);
    if (file_exists(fname)) { fprintf(stderr, "error: %s already exists, not overwriting\n", fname); }
    else {
      fp = fopen(fname, "wb");
      fwrite(outputs[i].data, outputs[i].size, 1, fp);
      fclose(fp);
    }
#else
    printf("%d\n", (int) outputs[i].size);
    fwrite(outputs[i].data, outputs[i].size, 1, stdout);
#endif
    free(outputs[i].data); 
  }
  
  ERROR_main:
  free(infiles);
  free(crops);
  free(outputs);
  return ret;
}

#else
/* ////////////////////////////////////////////////////////////////////////// */
/* //                 For compilation as a Ruby extension                  // */
/* ////////////////////////////////////////////////////////////////////////// */

VALUE Module = Qnil;

// Our 'test1' method.. it simply returns a value of '10' for now.
VALUE PNGFIFO_chunk_split(int argc, VALUE *args, VALUE self) {
  buffer* outputs = NULL;
  int nils = 0,
    chunk_width, inputc, num_outputs, i;
  VALUE chunk_width_val, inputs, input, path, x_offset, width;
  char* error = NULL;
  char** infiles = NULL;
  xrange* crops = NULL;
  
  rb_scan_args(argc, args, "1*", &chunk_width_val, &inputs);
  chunk_width = NUM2INT(chunk_width_val);
  if(NIL_P(inputs) || (inputc = NUM2INT(rb_funcall(inputs, rb_intern("size"), 0))) == 0){
    rb_raise(rb_eArgError, "At least one input InterimFile must be given");
  }
  
  infiles = (char**) malloc(sizeof(char*) * inputc);
  crops = (xrange*) malloc(sizeof(xrange) * inputc);
  for (i = 0; i < inputc; i++) {
    input = rb_ary_shift(inputs);
    if (NIL_P(input)) { nils++; }
    else {
      path = rb_funcall(input, rb_intern("path"), 0);
      if (NIL_P(path) || !rb_respond_to(input, rb_intern("pix_margin")) 
          || !rb_respond_to(input, rb_intern("pix_data"))) {
        error = "The splat arguments must be InterimFiles";
        goto CLEANUP_PNGFIFO_chunk_split;
      }
      x_offset = rb_funcall(input, rb_intern("pix_margin"), 0);
      width = rb_funcall(input, rb_intern("pix_data"), 0);
      infiles[i - nils] = StringValueCStr(path);
      crops[i - nils].x_offset = FIXNUM_P(x_offset) ? NUM2INT(x_offset) : 0;
      crops[i - nils].width = FIXNUM_P(width) ? NUM2INT(width) : 0;
    }
  }
  if (nils == inputc) {
    error = "All the arguments were nil";
    goto CLEANUP_PNGFIFO_chunk_split;
  }
  
  /* mallocs outputs and outputs[].data */
  num_outputs = montage_and_chunk(chunk_width, infiles, inputc - nils, crops, &outputs);
  
  /* Sets the last input's pix_margin and pix_data to nil, since it has now been montaged & cropped. */
  rb_funcall(input, rb_intern("pix_margin="), 1, Qnil);
  rb_funcall(input, rb_intern("pix_data="), 1, Qnil);

  for (i = 0; i < num_outputs; i++) {
    rb_yield(rb_str_new(outputs[i].data, (long) outputs[i].size));
    free(outputs[i].data); 
  }
  
  CLEANUP_PNGFIFO_chunk_split:
  if (error != NULL) { rb_raise(rb_eArgError, error); }
  free(outputs);
  free(infiles);
  free(crops);
  return INT2NUM(num_outputs);
}

// The initialization method for this module
void Init_png_fifo_chunker() {
  Module = rb_define_module("PNGFIFO");
  rb_define_method(Module, "chunk_split", PNGFIFO_chunk_split, -1);
}

#endif