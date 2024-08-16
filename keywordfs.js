#!/usr/bin/env node 

const fuse = require('node-fuse-bindings');
const fs = require('fs');
const pathLib = require('path');
const process = require('process');
const os = require('os');

// this part is to patch the Set prototype so that we can use intersection and 
// difference as specified in the ECMAScript 6 standard
if (Set.prototype.intersection === undefined) {
    const intersection = require('set.prototype.intersection');
    intersection.shim();
}

if (Set.prototype.difference === undefined) {
    const difference = require('set.prototype.difference');
    difference.shim();
}


// the main documentation for the fuse bindings is here:
// https://github.com/direktspeed/node-fuse-bindings
// alias tp='if [ -f "@@" ]; then cd `cat @@`; fi'

if (process.argv.length < 4) {
    console.log('Usage: node badgefs.js <mountpoint> <referencepoint>');
    process.exit(1);
}

const mountpoint = pathLib.resolve(process.argv[2]);
const referencepoint = pathLib.resolve(process.argv[3]);

class BadgeEntry {
    #name = '';
    #nodes = [];

    constructor(name) {
        this.#name = name;
    }

    get name() {
        return this.#name;
    }   

    addNode(node) {
        this.#nodes.push(node);
    }

    removeNode(node) {
        this.#nodes = this.#nodes.filter((x) => x.name !== node.name);
    }

    get nodes() {
        return this.#nodes;
    }
}

// let's create a node class
class BadgeNode {
    #name = '';
    #entries = [];

    constructor(name) {
        this.#name = name;
    }

    get name() {
        return this.#name;
    }

    addEntry(entry) {
        this.#entries.push(entry);
    }

    removeEntry(entry) {
        this.#entries = this.#entries.filter((x) => x !== entry);
    }

    get entries() {
        return this.#entries;
    }

}

class KeywordCacheEntry {
    #path = '';
    #content = [];
    #references = [];

    constructor(path, content, references) {
        this.#path = path;
        this.#content = content;
        this.#references = references;
    }

    get path() {
        return this.#path;
    }

    get content() {
        return this.#content;
    }

    get references() {
        return this.#references;
    }

}



class KeywordFS  {
    #mountpoint = '';
    #referencepoint = '';
    #badgeNodes = new Map();
    #badgeEntries = new Map();
    #cache = new Map();
    #link = '@';

    constructor(mountpoint, referencepoint) {
        this.#mountpoint = mountpoint;
        this.#referencepoint = referencepoint;
        this.#readDir(referencepoint);
    }

    set link(link) {
        this.#link = link;
    }

    #splitPath(path) {
        return path.split(pathLib.sep).filter((x) => x !== '');
    }

    #insertDir(entryPath) {
        const badgeEntry = new BadgeEntry(entryPath);
        this.#badgeEntries.set(entryPath, badgeEntry);

        const components = this.#splitPath(pathLib.relative(this.#referencepoint,entryPath)).map((x) => {
            let badgeNode = this.#badgeNodes.get(x);
            if (badgeNode === undefined) {
                badgeNode = new BadgeNode(x);
                this.#badgeNodes.set(x, badgeNode);
            }
            badgeNode.addEntry(badgeEntry);
            badgeEntry.addNode(badgeNode);
        });
    }

    #readDir(path) {
        const entries = fs.readdirSync(path);
        for (let entry of entries) {
            const entryPath = path + '/' + entry;

            const stats = fs.statSync(entryPath);
            if (stats.isDirectory()) {
                this.#insertDir(entryPath);
                this.#readDir(entryPath)
            } 
        }
    }

    getReference(path) {
        return pathLib.resolve(this.#referencepoint, '.' + path);
    }

    #getActualEntry(path) {
        console.log('get actual entry', path);
        let self = this;
        if (this.#cache.has(path)) {
            console.log('cache hit', path);
            return this.#cache.get(path);
        }
        console.log('cache miss', path);

        let entries = new Set();
        // special case for the root
        if (path === '/') {
            entries = this.#badgeNodes.values();
            let contents = Array.from(entries).map((x) => x.name);
            fs.readdirSync(this.#referencepoint).forEach((x) => {
                if (fs.statSync(this.#referencepoint + pathLib.sep + x).isFile()) {
                    contents.push(x);
                }
            });
            contents.push('.');
            contents.push('..');
            let result = new KeywordCacheEntry(this.#referencepoint, contents, path);
            // not sure if this is a good idea to set it in cache
            // more memory usage but faster access
            this.#cache.set(path, result);
            return result;
        } 

        this.#splitPath(path).forEach((x) => {
            const node = self.#badgeNodes.get(x);
            if (node !== undefined) {
                let newEntries = new Set();
                node.entries.map((x) => newEntries.add(x));
                entries = (entries.size === 0)? newEntries: entries.intersection(newEntries);
            }
        });

        const nodes = new Set();
        entries.forEach((x) => { x.nodes.map((x) => nodes.add(x.name)) });

        let arr = Array.from(entries).sort((a,b) => a.name.length - b.name.length);
        if (arr.length === 0) {
            return undefined;
        }
        // compute actual path and store it in the cache
        let actualPath = arr[0].name;
        let files = fs.readdirSync(actualPath);
        let listing = [];

        // we actually need to filter out all components of the path
        this.#splitPath(path).forEach((x) => {
            nodes.delete(x);
        });

        // we also need to filter out components from the actual path
        this.#splitPath(pathLib.relative(this.#referencepoint, actualPath)).forEach((x) => {
            nodes.delete(x);
        });

        nodes.forEach((x) => {  listing.push(x); });

        fs.readdirSync(actualPath).forEach(function(entry) {
            const entryPath = actualPath + pathLib.sep + entry;
            if (fs.statSync(entryPath).isFile()) listing.push(entry);
        });

        listing.push('.');
        listing.push('..');
        listing.push(this.#link);

        let result = new KeywordCacheEntry(actualPath, listing, arr);
        this.#cache.set(path, result);
        return result
    }


    #open(path, flags, cb) {
        console.log('open', path, flags);

        if (path === pathLib.sep) { cb(0,fs.openSync(this.#referencepoint)); return; }
        if (pathLib.basename(path) === this.#link) { cb(0,0); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        const base = pathLib.basename(path);
        if (fs.readdirSync(basePath.path).find((x) => x === base)) {
            const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
            if (fs.existsSync(actualFile)) {
                cb (0, fs.openSync(actualFile, flags));
                return ; 
            } 
        }
                    
        if (basePath.content.find((x) => x === base)) {
            cb(0, fs.openSync(this.#getActualEntry(path).path, flags));
            return;
        }
        cb(fuse.ENOENT);
    }


    #opendir(path, flags, cb) {
        console.log('opendir', path, flags);
        if (path === pathLib.sep) { cb(0,fs.openSync(this.#referencepoint)); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); console.log('blip');return; }

        const base = pathLib.basename(path);
        if (
            fs.readdirSync(basePath.path).find((x) => x === base) ||
            basePath.content.find((x) => x === base)
        ) {
            cb(0,fs.openSync(this.#getActualEntry(path).path, flags));
            return;
        }
        cb(fuse.ENOENT);
    }

    #access(path, mode, cb) {
        console.log('access', path, mode);
        if (path === pathLib.sep) { cb(0); return; }
        if (pathLib.basename(path) === this.#link) { cb(0); return; }

        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT);  return; }

        const base = pathLib.basename(path);
        if (fs.readdirSync(basePath.path).find((x) => x === base)) {
            try {
                fs.accessSync(basePath.path + pathLib.sep + base, mode);
                cb(0);
                return;
            } catch (err) { cb(fuse.EACCES);  return; }   
        }
        
        if (basePath.content.find((x) => x === base)) { cb(0);  return; } 
        cb(fuse.ENOENT);
    }


    #readdir(path, cb) {
        console.log('readdir', path);
        cb(0, this.#getActualEntry(path).content);
    }




    #read(path, fd, buffer, length, position, cb) {
        cb(fs.readSync(fd, buffer, 0, length, position));
    }

    #write(path, fd, buffer, length, position, cb) {
        cb(fs.writeSync(fd, buffer, 0, length, position));        
    }

    #flush(path, fd, cb) {
        console.log('flush', path, fd);        
        cb(0,fs.fsyncSync(fd));                
    }

    #ftruncate(path, fd, size, cb) {
        cb(fs.ftruncateSync(fd, size));
    }



    #rename(src, dest, cb) {
        // TODO: to implement
        //fs.renameSync(this.getReference(src), this.getReference(dest))
        cb(0);
    }

    // TODO check this
    #release(path, fd, cb) {
        console.log('release', path, fd);
        if (fd !== 0) {
            cb(fs.closeSync(fd));
        } else {
            cb();
        }
    }

    #releasedir(path, fd, cb) {
        console.log('releasedir', path, fd);
        /*cb(0);*/
        if (fd !== 0) {
            cb(fs.closeSync(fd));
        } else {
            cb(0);
        }
    }

    #statfs(path, cb) {
        cb(0, fs.statfsSync(this.#referencepoint));
    }


    #fgetattr(path, fd, cb) {
        console.log('fgetattr', path, fd);
        this.#getattr(path, cb);
    }

    #getattr(path, cb) {
        console.log('getattr', path);
        const basePath = this.#getActualEntry(pathLib.dirname(path));

        if (path === pathLib.sep || pathLib.basename(path) === this.#link) {
            cb(0, {
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                size: (path === pathLib.sep)?4096:basePath.path.length,
                mode:  ((path === pathLib.sep) ? 
                    (fs.constants.S_IFDIR | fs.constants.S_IRWXU):
                    (fs.constants.S_IFLNK | fs.constants.S_IRUSR)),
                uid: process.getuid(),
                gid: process.getgid()
            });
            return;
        }

        if (path === pathLib.sep) { cb(0,fs.openSync(this.#referencepoint)); return; }
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        const base = pathLib.basename(path);
        if (fs.readdirSync(basePath.path).find((x) => x === base)) {
            const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
            if (fs.existsSync(actualFile)) {
                let stats = fs.statSync(actualFile);
                cb(0, {
                    mtime: stats.mtime,
                    atime: stats.atime,
                    ctime: stats.ctime,
                    size: stats.size,
                    mode: stats.mode,
                    uid: stats.uid,
                    gid: stats.gid
                });
                return ; 
            }             
        }
                    
        if (basePath.content.find((x) => x === base)) {
            cb(0, {
                mtime: new Date(),
                atime: new Date(),
                ctime: new Date(),
                size: 4096,
                mode: fs.constants.S_IFDIR | fs.constants.S_IRWXU,
                uid: process.getuid(),
                gid: process.getgid()
            });
            return;
        }
        cb(fuse.ENOENT);

    }   
    
    #mkdir(path, mode, cb) {
        console.log('mkdir', path, mode);

        if (path === pathLib.sep) { cb(fuse.EEXIST); return; }

        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        // for the moment, we clear all cache entries
        this.#cache.clear();
        const newDir = basePath.path + pathLib.sep + pathLib.basename(path);
        this.#insertDir(newDir);
        cb(0, fs.mkdirSync(newDir, mode));
    }

    #rmdir(path, cb) {
        console.log('rmdir', path);
        if (path === pathLib.sep) { cb(fuse.EPERM); return;}

        const basePath = this.#getActualEntry(path);
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        this.#cache.clear();

        // we need to remove the directory from the badge entries
        let entry = this.#badgeEntries.get(basePath.path);
        entry.nodes.forEach((x) => x.removeEntry(entry));
        this.#badgeEntries.delete(basePath.path);

        cb(0, fs.rmdirSync(basePath.path));
    }


    #truncate(path, size, cb) {
        console.log('truncate', path, flags);

        if (path === pathLib.sep) { cb(fuse.EISDIR); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
        if (fs.existsSync(actualFile)) {
            cb (0, fs.truncateSync(actualFile, size));
            return ; 
        } 
        cb(fuse.ENOENT);
    }

    #readlink(path, cb) {
        console.log('readlink', path);

        if (path === pathLib.sep) { cb(fuse.ENOENT); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }
        if (pathLib.basename(path) === this.#link) { 
            cb(0,basePath.path); 
            return; 
        }

        const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
        if (fs.existsSync(actualFile)) {
            cb (0, fs.readlinkSync(actualFile));
            return ; 
        } 
        cb(fuse.ENOENT);
    }

    #unlink(path, cb) {
        console.log('unlink', path);

        if (path === pathLib.sep) { cb(fuse.EISDIR); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }
        this.#cache.delete(pathLib.dirname(path));

        const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
        if (fs.existsSync(actualFile)) {
            cb (0, fs.unlinkSync(actualFile));
            return ; 
        } 
        cb(fuse.ENOENT);
    }

    #create(path, mode, cb) {
        console.log('create', path, mode);

        if (path === pathLib.sep) { cb(fuse.EEXIST); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }
        this.#cache.delete(pathLib.dirname(path));
        const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);
        cb(0,fs.openSync(actualFile,'w', mode));
    }

    #utimens(path, atime, mtime, cb) {
        console.log('utime', path, atime, mtime);
        if (path === pathLib.sep) { cb(fuse.EACCES); return; }
        const basePath = this.#getActualEntry(pathLib.dirname(path));
        if (basePath === undefined) { cb(fuse.ENOENT); return; }

        const actualFile = basePath.path + pathLib.sep + pathLib.basename(path);

        cb(0, fs.utimesSync(actualFile, atime, mtime));
    }



    mount() {
        const self = this;
        this.#readDir(this.#referencepoint);
        fuse.mount(this.#mountpoint, {
            // let's put the ops here
            open: self.#open.bind(self),
            opendir: self.#opendir.bind(self),
            access: self.#access.bind(self),
            readdir: self.#readdir.bind(self),
            read: self.#read.bind(self),
            write: self.#write.bind(self),
            rename: self.#rename.bind(self),
            release: self.#release.bind(self),
            releasedir: self.#releasedir.bind(self),
            getattr: self.#getattr.bind(self),
            fgetattr: self.#fgetattr.bind(self),
            statfs: self.#statfs.bind(self),
            mkdir: self.#mkdir.bind(self),
            rmdir: self.#rmdir.bind(self),
            flush: self.#flush.bind(self),
            ftruncate: self.#ftruncate.bind(self),
            truncate: self.#truncate.bind(self),
            readlink: self.#readlink.bind(self),
            unlink: self.#unlink.bind(self),
            create: self.#create.bind(self),
            utimens: self.#utimens.bind(self)
        }, function (err) {
            if (err) throw err
            console.log('filesystem mounted on ' + self.#mountpoint)
        });
    }

    unmount() {
        const self = this;
        let handleUnmountError = function(err) {
            if (err) {
                console.log('filesystem at ' + self.#mountpoint + ' not unmounted', err)
            } else {
                console.log('filesystem at ' + self.#mountpoint + ' unmounted')
            }
        };
        fuse.unmount(this.#mountpoint, handleUnmountError)
    }

}

const keywordFS = new KeywordFS(mountpoint, referencepoint);
keywordFS.mount();

process.on('SIGINT', function () { keywordFS.unmount(); });
process.on('SIGTERM', function () { keywordFS.unmount(); });

