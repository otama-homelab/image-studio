#ifndef IMAGE_STUDIO_PILLOW_STANDALONE_TYPES_H
#define IMAGE_STUDIO_PILLOW_STANDALONE_TYPES_H
/* Type-only shim for private, standalone Resample.c builds, NOT a Python API.
 * The upstream headers carry unused PyObject pointers and I/O declarations.
 * Resample.c and our RGB host never dereference those pointers or call Python.
 * Do not link this ABI with Pillow/CPython objects or enable the GIL-disabled ABI.
 */
#ifdef Py_GIL_DISABLED
#error Standalone resize does not implement the CPython free-threaded ABI
#endif
#if !defined(__BYTE_ORDER__) || __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error This standalone proof currently requires a little-endian compiler target
#endif
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#define HAVE_PROTOTYPES 1
#define STDC_HEADERS 1
typedef struct ImageStudioUnusedPyObject PyObject;
typedef intptr_t Py_ssize_t;
typedef char ImageStudioInt32MustBe4[(sizeof(int32_t)==4)?1:-1];
typedef char ImageStudioFloatMustBe4[(sizeof(float)==4)?1:-1];
typedef char ImageStudioDoubleMustBe8[(sizeof(double)==8)?1:-1];
#endif
