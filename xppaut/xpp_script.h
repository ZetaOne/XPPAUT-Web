#ifndef _xpp_script_h
#define _xpp_script_h
#include <X11/Xlib.h>

/* command line */
void script_set_file(const char *name);
void script_set_options(int nopause,int exitflag);   /* -1 leaves a value unchanged */
int  script_requested(void);
void script_run_from_menu(void);   /* File -> Do script */

/* lifecycle */
int  script_load(void);
void script_start(void);        /* call just before the main event loop */
int  script_is_active(void);
void script_set_top(int flag);  /* 1 while the main loop waits for an event */

/* driven from xpp_next_event() */
int  script_poll(int *ms,XEvent *ev);    /* 0 idle, 1 ran a command, 2 timed wait, 3 *ev is a key */
int  script_filter_event(XEvent *ev);    /* 1 = event consumed */

/* prompts ask for a scripted answer before they open:
   1 = answered, 0 = open normally, -1 = script error (act as Cancel) */
int script_take_text(const char *label,char *buf,int cap);
int script_take_choice(const char *prompt,const char *key,int *index);
int script_take_form(const char *title,int n,char **names,char *vals,int stride);
int script_message(const char *msg);     /* 1 = suppress the error box */

/* commands that wait for the mouse ask for a scripted click / drag before they wait:
   1 = supplied (window pixels), 0 = wait for the mouse as usual, -1 = script error (act as Esc) */
int script_mouse_point(int *x,int *y);
int script_mouse_drag(int *x1,int *y1,int *x2,int *y2);

int    script_nopause(void);
double script_key_delay(void);
#endif
