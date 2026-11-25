#ifndef _MAPMANIFOLD_H_
#define _MAPMANIFOLD_H_

/*
 * One-dimensional stable manifold of a saddle fixed point of a planar map
 * F:R^2->R^2, computed WITHOUT the inverse map.
 *
 * Method (after England, Krauskopf & Osinga, "Computing one-dimensional
 * stable manifolds and stable sets of planar maps without the inverse",
 * SIAM J. Appl. Dyn. Syst. 3 (2004) 161-190):
 *
 * The manifold is grown as a polyline P_0=p, P_1, P_2, ... in order of
 * increasing arclength.  The point P_{k+1} is a point z on a search circle
 * of radius Delta about P_k such that F(z) lies on the part of the polyline
 * already computed (z in F^{-1}(W^s) = W^s).  It is located by intersecting
 * the image under F of an arc of the circle with the polyline, then
 * refining by bisection.  Delta is adapted using the turning angle alpha
 * and the deviation alpha*Delta.  If the stable multiplier is negative, F
 * interchanges the two branches, so both branches are grown in lock step
 * and each is searched against the other.
 */

typedef int (*MapFn)(const double *x, double *y, void *ctx); /* 1 = ok */

typedef struct {
  double delta0;  /* initial distance of P_1 from the fixed point        */
  double dmin;    /* smallest search-circle radius before giving up      */
  double dmax;    /* largest search-circle radius                        */
  double amin;    /* grow the step if the turning angle is below this    */
  double amax;    /* largest turning angle between segments (radians)    */
  double devmin;  /* grow the step if alpha*Delta is below this          */
  double dev;     /* largest alpha*Delta (deviation from the manifold)   */
  double maxlen;  /* maximal arclength of each branch                    */
  int    maxpts;  /* maximal number of points of each branch             */
  double xlo,xhi,ylo,yhi; /* computation stops when a branch leaves this */
} MfParams;

typedef struct {
  double *x,*y;   /* the points                                          */
  int *idx;       /* idx[k]: segment of the target branch containing
                     F(P_k)                                              */
  int n,cap;
  double len;     /* arclength so far                                    */
  double Delta;   /* current search-circle radius                        */
  int active;
  int why;        /* reason for stopping, see MF_STOP_*                  */
} MfBranch;

#define MF_STOP_NONE   0
#define MF_STOP_BOX    1  /* left the computational box                  */
#define MF_STOP_LEN    2  /* reached maximal arclength                   */
#define MF_STOP_PTS    3  /* reached maximal number of points            */
#define MF_STOP_STEP   4  /* no admissible step (Delta < dmin)           */
#define MF_STOP_MEM    5

/* p: fixed point, v: unit stable eigenvector, lambda: its (real) multiplier,
   |lambda|<1.  On return br[0] is the branch in direction +v and br[1] in
   direction -v.  Returns 0 on success, nonzero on bad input / no memory.  */
int mf_stable_manifold(MapFn F,void *ctx,const double *p,const double *v,
		       double lambda,const MfParams *par,MfBranch br[2]);
void mf_free(MfBranch *b);

#endif
