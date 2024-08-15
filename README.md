# keywordfs
Well, what if directory names were keywords?

## Concept
Being organized in your file systems means that we usually attach semantics to directories. For example, they can be sorted by activities, projects, years and so on...
The more it is organized, the more, you have built a hierarchy with directories. It is nice, except, ... you have to go all the way down to the hierarchy in order to find the pieces of information you put in some files...

The idea behind keywordfs is to remount your filesystem so that the names of the directories are keywords. Then you can navigate through them using keywords instead of a full hierarchy. The idea is that you can borrow shortcuts to get the files. 

Here is an example in order to understand the idea. Let's suppose that we have this kind of directory hierarchy in a part of your physical file system

```
|- research
|  |- projects
|  |  |- ResearchProjectA
|  |  |  |- 2020
|  |  |  |- 2021
|  |  |- ResearchProjectB
|  |  |  |- 2021
|  |  |  |- 2022
|- teaching
   |- 2021
   |  |- SubjectA
   |  |- SubjectB
   |- 2022
      |- SubjectB
      |- SubjectC
```
We have then the following keywords:
`research`,`projects`,`ResearchProjectA`,`ResearchProjectB`,`2020`,`2021`,`2022`,`teaching`,`subjectA`,`subjectB`,`subjectC`

If, at the root of the mounted virtual filesystem, I type:

* `cd 2020`: I will go to `research/projects/researchProjectA/2020`,
* `cd SubjectC`: I will go to `teaching/2022/SubjectC`,
* `cd 2021/researchProjectB`: I will go to `research/projects/researchProjectB/2021`,
* `cd 2022`: well, it will go to `teaching/2022` (shortest path in terms of string length and then first in alphabetical order). However, from this point, I will be able to see 5 subdirectories that are `research`, `projects`, `ResearchProjectB`, `SubjectB` and `SubjectC`. Basically, it means that I will be able to navigate to related keywords until there is a single entry that matches the keyword combination.

There you have the concept behind **keywordfs**.

## Setup
You will need `git` and `nodeJS` or equivalents.

You first have to clone this repository: 
```
$ git clone https://github.com/jydidier/keywordfs.git
```
Then, you will have to install javascript dependencies:
```
cd keywordfs
npm install
```
Dependencies are using a slightly modified version of <https://github.com/direktspeed/node-fuse-bindings>, needed for more recent systems as well as polyfills for the definition of `Set` that, in some versions of nodeJS, was missing some of the ECMAScript 6 specifications.

## Use

Go into your `keywordfs` directory and then start it 
```
$ node keywordfs.js <mountpoint> <referencepoint>
```
Then, you can enjoy it by going to the mountpoint.

## TODO

Many things are still needed for this proof of concept

* implement many FUSE operations
* check performance issues that may arise
* transform it as a usable npm package
* 
