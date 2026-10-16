# Native measurement records

These are preliminary runs, not release certification. The JSON identifies viewport, build mode, texture/draw counts, and CPU-side rendering measurements. Camera-change-to-frame timings do not measure physical input latency or GPU completion.

The `release-single-group` run used the earlier fixture with one root group. The current fixture adds three nested boundaries at the same total node/edge counts; repeat measurement before comparing results. It used a 1046×918 window at DPR 1 on Omarchy / WebKitGTK 2.52.6. WebGL reported `Apple GPU` despite Linux Intel/NVIDIA hardware; treat these privacy-masked strings as unverified, not an identified active GPU.

Hardware inventory: Intel i9-11900H, 16 GB system RAM, Intel UHD + NVIDIA RTX 3060 Mobile. CPU/RSS, driver selection, physical latency, repeated warm/cold startup, and the 1920×1080 reference run remain to be measured. `navigationToScriptMs` starts at web navigation, not process launch.
