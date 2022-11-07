const schemaNames = { mapbox: 0, openmaptiles: 1 };


// park in mapbox is landuse->park, in openmaptiles it is landcover->grass->park
// paint data is not in taken into account

const crosswalk = [
    ['road:structure=tunnel', 'transportation:brunnel=tunnel'],
    ['road:structure=bridge', 'transportation:brunnel=bridge'],

    ['road:class=link', 'transportation:ramp=1'],
    ['road:class=major_rail', 'transportation:class=rail'],
    ['road:class=minor_rail', 'transportation:class=transit'],

    ['road:class=street', 'transportation:class=minor'],
    ['road:class=path', 'transportation:class=path'],
    ['road:class=.*', 'transportation:class=.*'],

    ['road_label:class=street',  'transportation_name:class=minor'],
    ['road_label:class=path','transportation_name:class=path'],
    ['road_label:class=.*', 'transportation_name:class=.*'],
    ['landuse:class=residential', 'landuse:class=residential'],
    ['landuse:class=glacier', 'landcover:subclass=glacier'],
    ['landuse:class=glacier', 'landcover:subclass=ice_shelf'],
    ['landuse:class=sand', 'landcover:class=sand'],
    ['landuse:class=park', 'landcover:class=grass'],
    ['landuse:class=pitch', 'landuse:class=pitch'],
    
    ['landuse_overlay:class=national_park', 'park:class=national_park'],
    ['landuse_overlay:class=wetland', 'landcover:class=wetland'],
    ['landuse_overlay:class=wetland_noveg', 'landcover:class=wetland'],

    // won't work until we solve types
    ['building:height=.*', 'building:render_height=.*'],
    ['building:_=.*', 'building:_=.*'],
    ['aeroway:type=runway', 'aeroway:class=runway'],
    ['aeroway:type=taxiway', 'aeroway:class=taxiway'],
    ['place_label:type=suburb', 'place:class=suburb'],
    ['place_label:type=.*', 'place:class=.*'],
    ['poi_label:type=.*', 'poi:class=.*'],

    ['water:class=water-pattern', 'water:class=lake'],
    // ['water:_=.*', 'water:class=*'],
    // ['waterway:class=.*', 'waterway:class=.*'],
    // ['water:_=.*', 'water:class=.*'] 



    // mapbox doesn't seem to have suburb boundaries?
    // also mapbox boundaries don't work cause admin levels have to be integers not strings
    ['admin:admin_level=.*', 'boundary:admin_level=.*'],

    // untested
    ['admin:maritime=1', 'boundary:maritime=1'],
];

function walk(from, to, layerName, key, value) {
    let fromIdx = schemaNames[from], toIdx = schemaNames[to];

    let mapping;
    if (key) {
        mapping = crosswalk.find(x =>{
            return (new RegExp(x[fromIdx])).test(`${layerName}:${key}=${value}`);
        } );
    } else {
        // no key/value to filter on? Just grab the first layer that matches at all.
        mapping = crosswalk.find(x => {
            return x[fromIdx].replace(/:.*$/, '') === layerName.replace(/:.*$/, '');
        });
    }
    console.log(mapping);         
    if (!mapping) {
        // console.log(`No mapping found for ${layerName}:${key}=${value}`);
        return undefined;
    }

    let m = mapping[toIdx].split(/[:=]/);
    if (m[2].match(/\*/)) {
        if (value) {
            m[2] = m[2].replace('.*', value);
        } else {
            // console.log(`No value to match ${layerName}:${key}=${value}`);
            // console.log(`No value to match against ${mapping[toIdx]}`);   
            return [m[0]];
        }
    }
    return m;
}


function targetLayer(from, to, sourceLayer, filter) {
    if (filter) {
        if (filter[0] === 'all')
            return filter.slice(1).reduce(((l, f) => l || targetLayer(from, to, sourceLayer, f)), undefined);
        if (filter[0].match(/^(==|!=|in|!in)$/) && filter[1] !== '$type') {
            const key = (typeof filter[1] === 'object' && filter[1][0] === 'get') ? filter[1][1] : filter[1];
            let tw = walk(from, to, sourceLayer, key, filter[2]);
            return tw && tw[0];
        }
    }
    let tw = walk(from, to, sourceLayer);
    return tw && tw[0];
}

function mapFilter(from, to, sourceLayer, filter) {
    // all -> map individual components
    // == $type -> leave unchanged
    // in -> map each element


    if (filter === undefined) {
        // here the source layer had no filter but we think the target should have one.
        let w = walk(from, to, sourceLayer);
        if (w && w.length == 3)
            return ['==', w[1], w[2]];
        else {
            console.log('No filter for ', sourceLayer, ' -> ', w);
            return undefined;
        }
        //return walk(from, to, sourceLayer);
    }
    //return filter;
    if (filter[0] === 'all') {
        if (filter.length === 1)

        return ['all', ...filter.slice(1)
            .map(f => mapFilter(from, to, sourceLayer, f))
            .filter(f => f !== undefined) // if a filter doesn't map to anything, just remove it
        ];
    }
    if (filter[0] === 'in') {
        // play it safe by converting 'in' to lots if independent matches, in case the key isn't the same
        return ['any', ...filter.slice(2)
            .map(value => mapFilter(from, to, sourceLayer, ['==', filter[1], value]))
            .filter(f => f !== undefined)
        ];
    }
    if (filter[0] === '!in') {
        return ['all', ...filter.slice(2)
            .map(value => mapFilter(from, to, sourceLayer, ['!=', filter[1], value]))
            .filter(f => f !== undefined)
        ];
    }
    if (filter[0] === '==' || filter[0] === '!=') {
        if (filter[1] === '$type')
            return filter;

        const key = (typeof filter[1] === 'object' && filter[1][0] === 'get') ? filter[1][1] : filter[1];
        let w = walk(from, to, sourceLayer, key, filter[2]);
        if (!w)
            return undefined;
        return [filter[0], w[1], w[2]];

    } else {
        return undefined;
    }
}

function mapLayers(fromSchema, toSchema, layers) {
    let outLayers = [];
    layers.forEach(l => {
        const sourceLayer = l['source-layer'];
        if ((sourceLayer === "water" || sourceLayer === "waterway") && !l.filter) {
            l.filter = [
                "==",
                [
                    "get",
                    "class"
                ],
                l.id
            ]
        }
        if (typeof l.filter === 'object' && l.filter.length < 3) {
            // defective filter in some liberty layers
            l.filter = undefined;
        }

        if (l.source === undefined) { // background layer

            return outLayers.push(l);
        } else if (l.source !== fromSchema) {
            console.warn('Skipping layer with source ' + l.source + ' (expected ' + fromSchema + ')');
            return
        }

        let tl = targetLayer(fromSchema, toSchema, sourceLayer, l.filter);
        if (!tl) {
            return;
        }
        // undefined l.filter is ok
        let tf = mapFilter(fromSchema, toSchema, sourceLayer, l.filter);


        let outLayer = JSON.parse(JSON.stringify(l));
        outLayer.source = toSchema; // ! conflating our name with internal source name
        outLayer['source-layer'] = tl;
        outLayer.filter = tf;
        outLayers.push(outLayer);
    });
    return outLayers;
}

function processStyle(fromSchema, toSchema, style, name = 'out') {
    let output = JSON.parse(JSON.stringify(style));
    output.layers = mapLayers(fromSchema, toSchema, style.layers);
    output.sources = {
        [toSchema]: output.sources[fromSchema]
    }
    require('fs').writeFileSync(`./out/${name}-${toSchema}.json`, JSON.stringify(output, undefined, 4));

}

let sourceName = 'style';
processStyle('mapbox', 'openmaptiles', require(`./in/${sourceName}.json`), sourceName);
