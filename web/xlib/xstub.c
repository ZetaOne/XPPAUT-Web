/*
 * Headless placeholder implementation of the Xlib functions XPPAUT uses.
 *
 * Step 2 of the web port: lets the unmodified XPPAUT source link and run
 * in batch (-silent) mode without libX11. Each function will be replaced by
 * a real implementation that draws on an HTML canvas.
 *
 * Set XPPWEB_TRACE=1 to log the first call to each unimplemented function.
 */
#include <stdio.h>
#include <stdlib.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/XKBlib.h>

static void unimplemented(const char *name, int *seen)
{
  if (*seen) return;
  *seen = 1;
  if (getenv("XPPWEB_TRACE")) fprintf(stderr, "xlib: %s not implemented\n", name);
}

int XAllocColor(Display* a0, Colormap a1, XColor* a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XAllocColor", &seen);
  return (int)0;
}

int XClearArea(Display* a0, Window a1, int a2, int a3, unsigned int a4, unsigned int a5, int a6)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  unimplemented("XClearArea", &seen);
  return (int)0;
}

int XClearWindow(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XClearWindow", &seen);
  return (int)0;
}

int XCloseDisplay(Display* a0)
{
  static int seen;
  (void)a0;
  unimplemented("XCloseDisplay", &seen);
  return (int)0;
}

int XCopyArea(Display* a0, Drawable a1, Drawable a2, GC a3, int a4, int a5, unsigned int a6, unsigned int a7, int a8, int a9)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  (void)a9;
  unimplemented("XCopyArea", &seen);
  return (int)0;
}

Pixmap XCreateBitmapFromData(Display* a0, Drawable a1, const char* a2, unsigned int a3, unsigned int a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XCreateBitmapFromData", &seen);
  return (Pixmap)0;
}

Cursor XCreateFontCursor(Display* a0, unsigned int a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XCreateFontCursor", &seen);
  return (Cursor)0;
}

GC XCreateGC(Display* a0, Drawable a1, unsigned long a2, XGCValues* a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XCreateGC", &seen);
  return (GC)0;
}

Pixmap XCreatePixmap(Display* a0, Drawable a1, unsigned int a2, unsigned int a3, unsigned int a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XCreatePixmap", &seen);
  return (Pixmap)0;
}

Pixmap XCreatePixmapFromBitmapData(Display* a0, Drawable a1, char* a2, unsigned int a3, unsigned int a4, unsigned long a5, unsigned long a6, unsigned int a7)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  unimplemented("XCreatePixmapFromBitmapData", &seen);
  return (Pixmap)0;
}

Window XCreateSimpleWindow(Display* a0, Window a1, int a2, int a3, unsigned int a4, unsigned int a5, unsigned int a6, unsigned long a7, unsigned long a8)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  unimplemented("XCreateSimpleWindow", &seen);
  return (Window)0;
}

int XDefineCursor(Display* a0, Window a1, Cursor a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XDefineCursor", &seen);
  return (int)0;
}

int XDestroySubwindows(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XDestroySubwindows", &seen);
  return (int)0;
}

int XDestroyWindow(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XDestroyWindow", &seen);
  return (int)0;
}

int XDrawArc(Display* a0, Drawable a1, GC a2, int a3, int a4, unsigned int a5, unsigned int a6, int a7, int a8)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  unimplemented("XDrawArc", &seen);
  return (int)0;
}

int XDrawLine(Display* a0, Drawable a1, GC a2, int a3, int a4, int a5, int a6)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  unimplemented("XDrawLine", &seen);
  return (int)0;
}

int XDrawPoint(Display* a0, Drawable a1, GC a2, int a3, int a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XDrawPoint", &seen);
  return (int)0;
}

int XDrawRectangle(Display* a0, Drawable a1, GC a2, int a3, int a4, unsigned int a5, unsigned int a6)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  unimplemented("XDrawRectangle", &seen);
  return (int)0;
}

int XDrawString(Display* a0, Drawable a1, GC a2, int a3, int a4, const char* a5, int a6)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  unimplemented("XDrawString", &seen);
  return (int)0;
}

int XFillArc(Display* a0, Drawable a1, GC a2, int a3, int a4, unsigned int a5, unsigned int a6, int a7, int a8)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  unimplemented("XFillArc", &seen);
  return (int)0;
}

int XFillRectangle(Display* a0, Drawable a1, GC a2, int a3, int a4, unsigned int a5, unsigned int a6)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  unimplemented("XFillRectangle", &seen);
  return (int)0;
}

int XFlush(Display* a0)
{
  static int seen;
  (void)a0;
  unimplemented("XFlush", &seen);
  return (int)0;
}

int XFree(void* a0)
{
  static int seen;
  (void)a0;
  unimplemented("XFree", &seen);
  return (int)0;
}

int XFreeGC(Display* a0, GC a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XFreeGC", &seen);
  return (int)0;
}

int XFreePixmap(Display* a0, Pixmap a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XFreePixmap", &seen);
  return (int)0;
}

int XGetGeometry(Display* a0, Drawable a1, Window* a2, int* a3, int* a4, unsigned int* a5, unsigned int* a6, unsigned int* a7, unsigned int* a8)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  unimplemented("XGetGeometry", &seen);
  return (int)0;
}

int XGetIconSizes(Display* a0, Window a1, XIconSize** a2, int* a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XGetIconSizes", &seen);
  return (int)0;
}

XImage * XGetImage(Display* a0, Drawable a1, int a2, int a3, unsigned int a4, unsigned int a5, unsigned long a6, int a7)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  unimplemented("XGetImage", &seen);
  return NULL;
}

int XGetInputFocus(Display* a0, Window* a1, int* a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XGetInputFocus", &seen);
  return (int)0;
}

int XGetWindowAttributes(Display* a0, Window a1, XWindowAttributes* a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XGetWindowAttributes", &seen);
  return (int)0;
}

int XIconifyWindow(Display* a0, Window a1, int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XIconifyWindow", &seen);
  return (int)0;
}

Atom XInternAtom(Display* a0, const char* a1, int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XInternAtom", &seen);
  return (Atom)0;
}

int XkbBell(Display * a0, Window a1, int a2, Atom a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XkbBell", &seen);
  return (int)0;
}

KeyCode XKeysymToKeycode(Display* a0, KeySym a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XKeysymToKeycode", &seen);
  return (KeyCode)0;
}

XFontStruct * XLoadQueryFont(Display* a0, const char* a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XLoadQueryFont", &seen);
  return NULL;
}

int XLookupString(XKeyEvent* a0, char* a1, int a2, KeySym* a3, XComposeStatus* a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XLookupString", &seen);
  return (int)0;
}

int XLowerWindow(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XLowerWindow", &seen);
  return (int)0;
}

int XMapRaised(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XMapRaised", &seen);
  return (int)0;
}

int XMapSubwindows(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XMapSubwindows", &seen);
  return (int)0;
}

int XMapWindow(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XMapWindow", &seen);
  return (int)0;
}

int XMoveResizeWindow(Display* a0, Window a1, int a2, int a3, unsigned int a4, unsigned int a5)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  unimplemented("XMoveResizeWindow", &seen);
  return (int)0;
}

int XNextEvent(Display* a0, XEvent* a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XNextEvent", &seen);
  fprintf(stderr, "xlib: XNextEvent called but there is no display\n");
  exit(1);
}

Display * XOpenDisplay(const char* a0)
{
  static int seen;
  (void)a0;
  unimplemented("XOpenDisplay", &seen);
  return NULL;
}

int XParseColor(Display* a0, Colormap a1, const char* a2, XColor* a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XParseColor", &seen);
  return (int)0;
}

int XPending(Display* a0)
{
  static int seen;
  (void)a0;
  unimplemented("XPending", &seen);
  return (int)0;
}

int XQueryColors(Display* a0, Colormap a1, XColor* a2, int a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XQueryColors", &seen);
  return (int)0;
}

int XRaiseWindow(Display* a0, Window a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XRaiseWindow", &seen);
  return (int)0;
}

int XReadBitmapFileData(const char* a0, unsigned int* a1, unsigned int* a2, unsigned char** a3, int* a4, int* a5)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  unimplemented("XReadBitmapFileData", &seen);
  return (int)0;
}

int XResizeWindow(Display* a0, Window a1, unsigned int a2, unsigned int a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XResizeWindow", &seen);
  return (int)0;
}

int XSelectInput(Display* a0, Window a1, long a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSelectInput", &seen);
  return (int)0;
}

int XSendEvent(Display* a0, Window a1, int a2, long a3, XEvent* a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XSendEvent", &seen);
  return (int)0;
}

int XSetBackground(Display* a0, GC a1, unsigned long a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetBackground", &seen);
  return (int)0;
}

int XSetDashes(Display* a0, GC a1, int a2, const char* a3, int a4)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  unimplemented("XSetDashes", &seen);
  return (int)0;
}

int XSetFillStyle(Display* a0, GC a1, int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetFillStyle", &seen);
  return (int)0;
}

int XSetFont(Display* a0, GC a1, Font a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetFont", &seen);
  return (int)0;
}

int XSetForeground(Display* a0, GC a1, unsigned long a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetForeground", &seen);
  return (int)0;
}

int XSetFunction(Display* a0, GC a1, int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetFunction", &seen);
  return (int)0;
}

int XSetInputFocus(Display* a0, Window a1, int a2, Time a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XSetInputFocus", &seen);
  return (int)0;
}

int XSetLineAttributes(Display* a0, GC a1, unsigned int a2, int a3, int a4, int a5)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  unimplemented("XSetLineAttributes", &seen);
  return (int)0;
}

int XSetWindowBackground(Display* a0, Window a1, unsigned long a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetWindowBackground", &seen);
  return (int)0;
}

int XSetWindowBackgroundPixmap(Display* a0, Window a1, Pixmap a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetWindowBackgroundPixmap", &seen);
  return (int)0;
}

int XSetWindowBorder(Display* a0, Window a1, unsigned long a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetWindowBorder", &seen);
  return (int)0;
}

int XSetWindowBorderWidth(Display* a0, Window a1, unsigned int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetWindowBorderWidth", &seen);
  return (int)0;
}

void XSetWMName(Display* a0, Window a1, XTextProperty* a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XSetWMName", &seen);
}

void XSetWMProperties(Display* a0, Window a1, XTextProperty* a2, XTextProperty* a3, char** a4, int a5, XSizeHints* a6, XWMHints* a7, XClassHint* a8)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  (void)a4;
  (void)a5;
  (void)a6;
  (void)a7;
  (void)a8;
  unimplemented("XSetWMProperties", &seen);
}

int XSetWMProtocols(Display* a0, Window a1, Atom* a2, int a3)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  (void)a3;
  unimplemented("XSetWMProtocols", &seen);
  return (int)0;
}

int XStringListToTextProperty(char** a0, int a1, XTextProperty* a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XStringListToTextProperty", &seen);
  return (int)0;
}

int XTextWidth(XFontStruct* a0, const char* a1, int a2)
{
  static int seen;
  (void)a0;
  (void)a1;
  (void)a2;
  unimplemented("XTextWidth", &seen);
  return (int)0;
}

int XUnloadFont(Display* a0, Font a1)
{
  static int seen;
  (void)a0;
  (void)a1;
  unimplemented("XUnloadFont", &seen);
  return (int)0;
}

