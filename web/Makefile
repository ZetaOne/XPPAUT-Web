# Build the unmodified XPPAUT source against our own Xlib layer
# (web/xlib) instead of libX11.
#
#   make headless        native binary            -> build/headless-cc/xppaut
#   make CC=clang-18 headless   same with clang -> build/headless-clang-18 (catches errors emcc will hit)
#   make wasm            WebAssembly with emcc    -> build/wasm/xppaut.mjs + .wasm
#
# Run from the repository root as `make -C web <target>`.

ROOT    := $(abspath ..)
XPP     := $(ROOT)/xppaut
OBJECTS := $(shell cat $(CURDIR)/objects.txt)
XLIB    := xstub.o

# Same feature set as the upstream Makefile, minus HAVEDLL (no dlopen in the
# browser).
DEFINES := -DNOERRNO -DNON_UNIX_STDIO -DAUTO -DCVODE_YES \
           -DMYSTR1=8.0 -DMYSTR2=1
INCLUDES := -I$(CURDIR)/include

CFLAGS  ?= -O2
# 30-year-old C: silence warnings from upstream code, keep the build quiet.
XPP_CFLAGS := -std=gnu99 -D_XOPEN_SOURCE=600 -fcommon -w $(DEFINES) $(INCLUDES)
OWN_CFLAGS := -std=c99 -Wall -Wextra $(INCLUDES)

.PHONY: headless wasm clean

# ---- native, headless -------------------------------------------------------
HL := $(ROOT)/build/headless-$(notdir $(CC))
headless: $(HL)/xppaut

$(HL)/xppaut: $(addprefix $(HL)/,$(OBJECTS) $(XLIB))
	$(CC) -fcommon -o $@ $^ -lm

$(HL)/%.o: $(XPP)/%.c | $(HL)
	$(CC) $(CFLAGS) $(XPP_CFLAGS) -c $< -o $@

$(HL)/%.o: xlib/%.c | $(HL)
	$(CC) $(CFLAGS) $(OWN_CFLAGS) -c $< -o $@

# ---- WebAssembly ------------------------------------------------------------
WA := $(ROOT)/build/wasm
EMCC ?= emcc
WASM_LDFLAGS := -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createXpp \
                -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1 \
                -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 \
                -sEXPORTED_RUNTIME_METHODS=callMain,FS \
                -sSTACK_SIZE=4MB -lnodefs.js

wasm: $(WA)/xppaut.mjs

$(WA)/xppaut.mjs: $(addprefix $(WA)/,$(OBJECTS) $(XLIB))
	$(EMCC) -O2 -o $@ $^ $(WASM_LDFLAGS)

$(WA)/%.o: $(XPP)/%.c | $(WA)
	$(EMCC) -O2 $(XPP_CFLAGS) -c $< -o $@

$(WA)/%.o: xlib/%.c | $(WA)
	$(EMCC) -O2 $(OWN_CFLAGS) -c $< -o $@

$(HL) $(WA):
	mkdir -p $@

clean:
	rm -rf $(HL) $(WA)
