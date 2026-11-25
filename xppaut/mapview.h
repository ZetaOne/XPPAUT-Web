#ifndef _MAPVIEW_H_
#define _MAPVIEW_H_
/* overlay curves (manifolds, cobwebs) that survive redraws */
void map_overlay_clear(void);
void map_overlay_redraw(void);
/* Numerics menu: parameters for stable manifolds of planar maps */
void map_manifold_params(void);
/* called from the singular point code for a saddle of a planar map */
void map_stable_manifold(double *x,double lambda,double *evec,int n);
/* Viewaxes menu */
void do_cobweb(void);
/* redraw a live cobweb after parameters/initial conditions changed */
void map_cobweb_refresh(void);
#endif
