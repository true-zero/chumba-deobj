const fs = require('fs');
const parser = require('@babel/parser');
const {default: generate} = require('@babel/generator');
const {default: traverse} = require('@babel/traverse');
const t = require('@babel/types');
const {find, goUpPath} = require('./matchers');

const writeFile = (f, data) => fs.writeFileSync(f, data, 'utf-8');
const readFile = f => fs.readFileSync(f, 'utf-8');

// const fileName = 'waf_challenge.beautify';
const fileName = 'waf_challenge_latest';
const data = readFile(`${fileName}.js`)
const tree = parser.parse(data);

let rootBase;
let rootStrLookupFuncName;

const resolveValue = (base, strLookupFuncName, arg) => {
    return eval(`(() => { ${base}\nreturn ${strLookupFuncName}(${arg});\n })();`);
};

const resolveStringCall = (strLookupFuncName, resolveValue) => {
    let [ok, strLookupFunc] = find(tree, {
        type: 'FunctionDeclaration',
        id: {
            type: 'Identifier',
            name: strLookupFuncName,
        }
    });
    processProxyRemap(strLookupFunc, strLookupFuncName, resolveValue);
}

const resolveRootStringCall = () => {
    const body = tree.program.body;
    rootBase = [
        generate(body[0]).code, // array string
        generate(body[1]).code, // lookup function
        '!' + generate(body[2].expression.expressions[0]).code // shuffler
    ].join('\n');
    rootStrLookupFuncName = body[1].id.name;

    resolveStringCall(rootStrLookupFuncName, (arg) => resolveValue(rootBase, rootStrLookupFuncName, arg));
};

const resolveOtherStringCalls = () => {
    const [ok, strLookupCalls] = find(tree, {
        type: 'FunctionDeclaration',
        params: {'$length': 2},
        body: {
            type: 'BlockStatement',
            body: [
                {
                    type: 'ReturnStatement',
                    argument: {
                        type: 'CallExpression',
                        callee: {type: 'AssignmentExpression'}
                    }
                }
            ]
        }
    }, true);

    strLookupCalls.forEach(f => {
        const strLookupFuncName = f.node.id.name;
        const shufflerFunc = goUpPath(find(tree, {
            type: 'ForStatement',
            init: {
                type: 'VariableDeclaration',
                declarations: [{
                    type: 'VariableDeclarator',
                    init: {name: strLookupFuncName},
                }]
            }
        })[1], 4)

        // shuffer has a remap to proxy function that references the root str lookup
        // get the proxy function name so we can recreate the reference.
        const shufflerRootProxyRemapVarName = shufflerFunc.node.argument.callee.body.body[0].declarations[0].init.name;

        const strLookupArrayName  = shufflerFunc.node.argument.arguments[0].name;
        const strLookupArrayBinding = shufflerFunc.scope.getBinding(strLookupArrayName);

        // we need to build base (array, string call, scrambler)
        const base = rootBase + '\n\n' + [
            generate(strLookupArrayBinding.path.node).code, // array string
            generate(f.node).code, // lookup function
            `let ${shufflerRootProxyRemapVarName} = ${rootStrLookupFuncName}`, // remake proxy func ref to root
            generate(shufflerFunc.node).code // shuffler
        ].join('\n');

        resolveStringCall(strLookupFuncName, (arg) => resolveValue(base, strLookupFuncName, arg));
    });
};

const processProxyRemap = (path, bindingName, resolveValue, output=false) => { // strLookupFunc,
    const strLookupBindings = path.scope.getBinding(bindingName);
    const strLookupRemaps = strLookupBindings.referencePaths
        .filter(x => ['VariableDeclarator', 'AssignmentExpression'].includes(x.parentPath.node.type)).map(x => x.parentPath);

    strLookupRemaps.forEach(p => {
        // the property name we have to access to get the name varies based on the node type
        const propName = p.node.type === 'VariableDeclarator' ? 'id' : 'left';
        const renamedTo = p.node[propName].name;

        p.scope.getBinding(renamedTo).referencePaths.forEach(refPath => {
            const refPathParent = refPath.parentPath;

            if(['VariableDeclarator', 'AssignmentExpression'].includes(refPathParent.node.type)) {
                processProxyRemap(refPathParent, renamedTo, resolveValue, true);
                return;
            }

            // we don't want to replace the calls that are within a parseInt since
            // they're in the unscrambler function and doing so leads to errornous
            // behaviour
            if(refPathParent.node.arguments === undefined ||
                refPathParent.parentPath.node?.callee?.name === 'parseInt') return;

            const arg = refPathParent.node.arguments[0].extra.raw;
            const val = resolveValue(arg);

            if(output) console.log(`${renamedTo}(${arg}) => ${val}`);
            refPathParent.replaceWith(t.stringLiteral(val));
        });
    });
};

const transformers = [
    {traversal: false, method: resolveRootStringCall},
    {traversal: false, method: resolveOtherStringCalls}
];

transformers.forEach(f => {
    if(f.traversal) {
        traverse(tree, f.method());
    } else {
        f.method();
    }
});

writeFile(`${fileName}.deobj.js`, generate(tree).code);


