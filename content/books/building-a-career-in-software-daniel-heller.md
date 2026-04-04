+++
author = "Gabriel Aleksandravicius"
title = '"Building a Career in Software" by Daniel Heller'
date = "2026-04-03"
tags = [
  "career",
  "industry",
  "landing-jobs",
]
categories = [
  "book"
]
+++

💬 This page is in progress as I'm still reading this book

# Introduction
## The author: Daniel Heller
Daniel Heller is an engineer at Uber who transitioned from senior software engineer to engineering manager, before returning to his roots as a developer and now serving as a principal engineer. He previously worked at Apple as a senior kernel engineer, and at AppDynamics as a senior software engineer and tech lead.

Contact info:
- [LinkedIn](https://www.linkedin.com/in/hellerdaniel/)
  

## What the book is about
While universities and software bootcamps teach students how to write code, Daniel argues that they leave graduates to teach themselves the required tools to thrive in real software companies. The purpose of the book is to serve as "a comprehensive guide to the essential skills that instructors don't need and professionals never think to teach: landing jobs, choosing teams and projects, asking good questions, running meetings, going on-call, debugging production problems, technical writing, making the most of a mentor, and much more".

# Quotes and notes
## Part 1 - Career
### Chapter 1 - The Big Picture
> If we exist to solve problems, then growth is being able to solve more, tougher and bigger problems. We do so with a vector of skills built over time: coding, project management, communication, personal organization/time management, architecture, leadership/mentorship, emotional skills.

> [Ten principles, principle 2] - Unblock yourself: never accept being blocked (...) your job is to figure out how to create value with your efforts.
  
- Although obvious, it's a valuable tip and I wish Gabriel from 6 years ago - when I got my first job - knew it. It's important to find - or at least pursue - a balance between finding a solution to any problem by yourself and asking for help. This is way easier today with the help of AI.

### Chapter 2 - Landing Jobs
> You should on no account confuse interview coding with the day-to-day work of a software engineer, which is far messier, mostly driven by the behavior of existing code, mostly about integrations and debugging, and almost never about cracking a tricky algorithmic problem (...). You should think of a coding interview as a performance art.

> You should negotiate unapologetically and professionally; remember that negotiating is completely reasonable and that if you stay positive and businesslike, they will too.

### Chapter 3 - Learning and Growing
> You should be reading (or watching or listening to) technical content every single weekday (...). It should be built into your routine like physical exercise or time with friends.
- That's actually what I'm trying to do with this blog: it motivates me to slowly-but-surely work on personal projects, read books, listen to podcasts and talk about these topics here :)

> A lot of talk on blogs and LinkedIn goes into overcoming imposter syndrome. I say embrace self-skepticism and doubt yourself every day. In a fast-moving industry where lots of your knowledge expires every year, even the most junior people around you constantly cook up skills you don't have; you stay competitive by applying yourself with the determination (and even fear) of the novice.
- Valuable tip as long as you don't go crazy and build up a lot of anxiety in the process 😅

> You should advocate for yourself, take risks, pat yourself on the back when things go well and, as you start to build a track record of solving problems, trust your skills and adaptability.

> You're only as good as the last problem you solve.

> If you're smart, you'll have the work you've done prodigiously in a work log.
  - Good tip and I wish I'd do this more often. Often times we have to write self-reviews and having to remember what we did 5 months ago is never fun.

> My experience (...) is that advancement and fulfillment flow from constantly hunting the toughest, most interesting problems you can find and solving them for the sheer joy of building things (what is engineering if not that?).

### Chapter 4 - Changes
> Starting a new engineering job is almost always profoundly unsettling (...). You're walking into a labyrinth of Byzantine development flows, barbarous shell scripts, and missing wikis that blunt technical knowledge. The comfort you knew as an expert in your old job is out the window.

> What you should do: refuse to stay blocked, read as much code as you can, ask questions as carefully as you can, take on dirty tasks and debug relentlessly, earn your colleague's respect with hard work and helpfulness and be patient.

> Most of the work done in the universe of software engineering goes to maintaining and modestly enhancing existing systems in streams of small features and bugs. In my opinion, making that your whole job is for suckers and you should never choose to work on a team where the technology is so mature and the vision so anemic that your life is organized around a bug queue rather than a story (...). My advice: seek out the biggest, most impactful problems you can find, deliver impact, maintain what you've built long enough to unambiguously prove success and clean up any messes you've created.

> Struggle is a constant. As you grow, you just struggle with bigger problems. (...) Avoiding struggle isn't a goal - our goals are to ensure that our struggles are productive and to manage the stress of that struggle.

## Part II - Day to Day at the Office
### Chapter 5 - Professional Skills
> People care about
>   1. Timeline
>   2. What's done
>   3. What's not done
>   4. Implications for downstream systems
> 
> Managers and project managers usually care more than anything about #1. Technical partners will care about all of the above.

> Estimation is the hardest problem in software:: Most software development is fundamentally unpredictable, dominated by the struggle to reveal the true complexity of problems that have not been (in every detail) solved before. (..) You will learn quite quickly that you and everyone else are quite bad at estimating how long even a bugfix will take.

> Pad your estimates by 2x: (...) Sketch the major pieces of your work, make your best wild guess at how long each will take, add them up and multiply by 2, and you might come close. As a special case of the principles of doing at least as well as you promise your stakeholders, it's far better to promise late and deliver early than vice versa.

> Overcommunicate your status: (...) The right time to communicate that you're going to slip is the very first microsecond you're aware of it; if you've chickened out on that first moment, then the second best time is right now. The later the news, the more embarrassing it will be to you and everyone who depends on you (...). If your manager is going to be angry, that is certainly their professional failing rather than yours, but telling them later is guaranteed to make it worse, not better.

> Here's my algorithm [for estimating work]:
>   1. Sit down with a pen and paper
>   2. List the major pieces of your work; draw your dependency graph.
>   3. Estimate the time for each piece.
>   4. Sum the estimated time for each work item that cannot or will not be done in parallel.
>   5. Add time for your testing; make it much longer than you expect, because you're guaranteed to underestimate.
>   6. Double the total.
>   7. Resist requests to reduce that estimate.

> If you remember only one principle of project leadership, remember that as project lead, your job is to deliver the project, full stop. There's no good excuse for not delivering, and therefore, you can never accept being blocked.

> When things seem bad, you do the exercise of thinking as if you were your boss (...). I've found this exercise asking, "what would I do if I had more authority", to be helpful many, many times = because if you know what you would do in your boss's chair, you can go to them with a solution, not a complaint.

> Here's a question I don't like:
>> Hey Kara, have you fixed that uncaught issue yet? It's blocking the rollout.
>
> Our implication is instantly that Kara should have fixed the bug - that we expect her to, that we're suspicious that she may not have, and that we'll look down on her if she hasn't. Why ask that way when we can ask as a friend?
>> Hey Kara, have you been able to look at that uncaught bug? I know you were also working on the fallback mechanism, so not sure if you've had a chance, but we do need it for the rollout.
>
> To me, this is all the difference in the world - we're signaling that we care about this bug, reminding Kara that it exists and that she should solve it and communicating its priority - but we're not implying any judgment. On the contrary, we're acknowledging that she's doing important work and that she may have a good reason for not yet giving us what we need.
- While this may seem like common sense - treating colleagues with empathy and respect - it’s unfortunately not always the norm. In that sense, it’s useful to make these expectations explicit, particularly in the tech industry where communication can sometimes be overly blunt.

# ...