// Shim for GCC's <bits/stdc++.h> on toolchains that ship libc++ instead
// (Apple clang, which is what `g++` resolves to on a stock macOS).
//
// Competitive-programming C++ solutions almost universally open with
// `#include <bits/stdc++.h>`. Without this header the classification sweep
// cannot compile a single C++ reference solution on macOS, so every
// C++-only problem would be reported as unverifiable.
//
// `classify_problems.py` adds this directory with -I, so the real libstdc++
// header wins wherever it exists (Linux) and this file is only a fallback.
//
// Note: GNU-only extensions such as <ext/pb_ds/...> are NOT provided — they
// have no libc++ equivalent. Solutions using them simply fail to compile and
// the sweep falls through to the next reference solution.

#ifndef DEADLOCK_BITS_STDCXX_SHIM_H
#define DEADLOCK_BITS_STDCXX_SHIM_H

#include <algorithm>
#include <array>
#include <atomic>
#include <bitset>
#include <cassert>
#include <cctype>
#include <cerrno>
#include <cfloat>
#include <chrono>
#include <cinttypes>
#include <ciso646>
#include <climits>
#include <clocale>
#include <cmath>
#include <complex>
#include <condition_variable>
#include <csetjmp>
#include <csignal>
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <cwchar>
#include <cwctype>
#include <deque>
#include <exception>
#include <forward_list>
#include <fstream>
#include <functional>
#include <future>
#include <iomanip>
#include <ios>
#include <iosfwd>
#include <iostream>
#include <istream>
#include <iterator>
#include <limits>
#include <list>
#include <locale>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <numeric>
#include <ostream>
#include <queue>
#include <random>
#include <ratio>
#include <regex>
#include <set>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <streambuf>
#include <string>
#include <system_error>
#include <thread>
#include <tuple>
#include <type_traits>
#include <typeinfo>
#include <typeindex>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <valarray>
#include <vector>

#endif  // DEADLOCK_BITS_STDCXX_SHIM_H
