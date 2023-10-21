const {default: traverse} = require('@babel/traverse');

const compareValue = (node, name, expectedValue) => {
    if(!node) return false;

    switch(typeof(expectedValue))
    {
        case 'object':
            if(Array.isArray(expectedValue)) { // means we are gonna access an array stuff should correlate to each other
                node = node[name];

                for(let i = 0; i < expectedValue.length; i++) {
                    for(const [name, expect] of Object.entries(expectedValue[i])) {
                        if(!compareValue(node[i], name, expect)) return false;
                    }
                }

                return true;
            }

            // means that the value is nested and the name given
            // is just the key
            if(typeof(expectedValue) == 'object') {
                node = node[name];
            }

            for(const [name, expect] of Object.entries(expectedValue)) {
                if(!compareValue(node, name, expect)) return false;
            }
            break;

        default:
            if(name[0] === '$')
            {
                switch (name)
                {
                    case '$length':
                        return node.length === expectedValue;

                    case '$value':
                        return node.value.includes(expectedValue);

                    default:
                        return false;
                }
            }

            if(node[name] !== expectedValue) return false;
            break;
    }

    return true;
}

const find = (tree, query, returnArray=false, skipCount=0) => {
    //if(length && tree.length !== length) return false;

    let found = [];

    const args = {
        [query.type]: (p) => {
            const node = p.node;
            const conditions = Object.entries(query).splice(1);

            let doesMeetConditions = true;

            for(const [name, expectedValue] of conditions) {
                if(!compareValue(node, name, expectedValue)) {
                    doesMeetConditions = false;
                    return;
                }
            }

            if(doesMeetConditions) {
                if(skipCount > 0) {
                    skipCount--;
                    return;
                }
                found.push(p);
                if(!returnArray) p.stop();
            }
        }
    };

    // If there is a traverse function, call it since it means we have passed a path
    // not a Program/File tree.
    if(tree.traverse) {
        tree.traverse(args)
    } else {
        traverse(tree, args);
    }

    return [found.length > 0, returnArray ? found : found[0]];
}

const goUpPath = (start, j) => {
    let p = start;

    for(let i = 0; i < j; i++) {
        p = p.parentPath;
    }

    return p;
};

module.exports = {
    find,
    goUpPath
};