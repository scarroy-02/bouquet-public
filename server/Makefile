CXX ?= g++
CXXFLAGS ?= -std=c++17 -O3 -pthread
# No fused multiply-adds, which clang makes by default where the CPU has them (Apple silicon): they round
# a * b + c once, so the largest value could map just outside GUDHI's extended ranges and its pairs be lost.
# "override", so that it stays when CXXFLAGS is given on the command line (the macOS build)
override CXXFLAGS += -ffp-contract=off
INCLUDES := -Ithird_party/include
# The surface computations and implicit.cpp need CGAL 6.2.1 (in /usr/local/include, before the system's CGAL 5.6) and Eigen;
# jet_fitting.h also needs the CGAL jet fitting example code from ../curvature_stability.
CGAL_INCLUDE ?= /usr/local/include
EIGEN_INCLUDE ?= /usr/include/eigen3
CGAL_FLAGS := -I$(CGAL_INCLUDE) -I$(EIGEN_INCLUDE) -I../curvature_stability -DCGAL_EIGEN3_ENABLED
LDLIBS := -lgmp -lmpfr
# PORTABLE=1 (the desktop app's build, see desktop/): a server that needs no libraries beyond the system's.
# CGAL then uses Boost.Multiprecision instead of GMP and MPFR (same results), and the C++ runtime is linked
# in, except on macOS, where it is part of the system. Run "make clean" when switching.
ifdef PORTABLE
CGAL_FLAGS += -DCGAL_DISABLE_GMP=1
LDLIBS :=
ifneq ($(shell uname -s),Darwin)
LDFLAGS += -static-libstdc++ -static-libgcc
endif
endif
# Windows (MSYS2 MinGW): cpp-httplib needs Winsock and the Windows 10 API; CGAL's object files need the
# big object format; link everything in, so that server.exe needs no MinGW DLLs
ifeq ($(OS),Windows_NT)
CXXFLAGS += -D_WIN32_WINNT=0x0A00 -Wa,-mbig-obj
LDLIBS += -lws2_32
LDFLAGS += -static
endif
# The surface computations (cgal_surface.h), one file per step (surface.h)
SURFACE := surface.o jet_fitting.o estimate.o fitted_surface.o exact_curves.o inflection_set.o simultaneity_set.o subdivide.o

server: server.o implicit.o $(SURFACE)
	$(CXX) $(CXXFLAGS) $(LDFLAGS) $^ -o $@ $(LDLIBS)

server.o: server.cpp cgal_surface.h implicit.h
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(INCLUDES) -c $< -o $@

implicit.o: implicit.cpp implicit.h
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(CGAL_FLAGS) $(INCLUDES) -c $< -o $@

$(SURFACE): %.o: %.cpp cgal_surface.h surface.h jet_fitting.h implicit.h ../curvature_stability/jet_fitting_example.h
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(CGAL_FLAGS) $(INCLUDES) -c $< -o $@

test: server
	python3 test_server.py

clean:
	rm -f server server.exe *.o

.PHONY: test clean
