+++
author = "Gabriel Aleksandravicius"
title = "Pointing My Career Toward Aerospace"
date = "2026-09-01"
summary = "A personal note on steering my side projects, and eventually my career, toward flight software and avionics work."
tags = [
  "career",
  "aerospace",
  "flight-software",
  "avionics",
  "embedded",
]
categories = [
  "career"
]
+++

I spent most of my career as a developer on the web side - backend/frontend, databases, CI/CD, the usual fullstack path. Recently, I was able to drift into the area that really makes my eyes shine: embedded work. Today I work as an embedded software engineer, doing a lot of work in the network industry. It's my first >real< job where the hardware has mattered as much as the code.

I say real because in 2019 I started working at an aerospace research group in college. That's where I had my first contact with the embedded world. I worked on the avionics system, developing software and hardware for a 3km-apogee rocket. I stayed in that group for 2.5 years and learned skills that are still useful to me to this day - for example, everything Altium-related that I used on my [Envelope](https://gabrielaleks.com/blog/designing-and-implementing-a-mail-detecting-system/) project I learned there! This experience had such a huge impact on me that I decided by then that's what I wanted to do for a living.

I am very happy with how my career has been oriented so far, and now that I finally started working in the embedded industry I am more motivated than ever to learn more and more each day to transition to the aerospace field. So, from now on, I want to point whatever personal-project time I have somewhere specific: flight software and avionics. My objective is to use the current homelab infrastructure that I have been progressively working on and build upon it.

My plan for getting there is the same one I use for everything else on this blog: several small, finished projects instead of one huge one I never finish. Envelope is the size and finish I want to match going forward. First up is closing a loop from that very post - I never actually measured the transmitter's real deep-sleep current draw. In fact, I deployed it a few days ago and I already know this is an issue, since I already had to change the battery twice. I want a proper power profiler on the bench to help me with that. After it, I'm looking at building a small multi-node CAN bus network, the kind used internally on small satellites, just to get a feel for arbitration and framing with more than two nodes on the line.

I took some time researching the skills I need to acquire and made myself a proper roadmap, so there's a longer list behind these two items I previously mentioned that I'm keeping to myself for now, circling mostly around real-time operating systems, the communication standards spacecraft use and redundancy. I'll write about each project here as I finish it, same as always!

Mostly, this post is a marker for myself: a note about which direction I'm pointing, so that a year from now I can check whether I actually walked toward it.