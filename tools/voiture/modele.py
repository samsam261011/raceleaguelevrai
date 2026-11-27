"""
Modèle 3D de la voiture de RaceLeague, construit dans Blender par ce script.

Lancer (Blender 4.2 ou plus récent, ou le module Python « bpy ») :
    blender --background --python tools/voiture/modele.py
    python tools/voiture/modele.py          (avec pip install bpy)

Produit :
    src/race/render/models/voiture.glb   (chargé par le jeu)
    tools/voiture/voiture.blend           (à ouvrir dans Blender pour retoucher à la main)

Repère : Blender a l'axe Z vers le haut ; l'avant de la voiture regarde vers -Y, sa gauche vers +X.
À l'export glTF, cela donne dans le jeu : avant vers +z, haut vers +y, gauche vers +x.
Dimensions réelles en mètres, alignées sur les roues de la physique (src/race/physics/constants.ts).

Matériaux (noms repris par le jeu) :
    Peinture  couleur du rang du joueur (remplacée en jeu)
    Carbone   bas de caisse, aileron, prises d'air
    Bande     filet blanc
    Vitre     bulle du cockpit
    Phares    phares avant (lumineux)
    Feux      feux arrière (s'allument au freinage)
    Pneu, Jante, Accent   roues
"""
import math
import os
import sys

import bpy  # en premier : il rend disponibles bmesh et mathutils
import bmesh
from mathutils import Matrix, Vector

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.abspath(os.path.join(ICI, "..", ".."))
SORTIE_GLB = os.path.join(RACINE, "src", "race", "render", "models", "voiture.glb")
SORTIE_BLEND = os.path.join(ICI, "voiture.blend")

# Roues (repère du jeu : x à gauche, z vers l'avant), identiques à WHEELS dans constants.ts
ROUE_AV = dict(x=1.0, z=1.55, r=0.47, w=0.42)
ROUE_AR = dict(x=0.98, z=-1.45, r=0.51, w=0.5)


def jeu(x, y, z):
    """Point du repère du jeu (x gauche, y haut, z avant) vers le repère de Blender."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- scène vide
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def materiau(nom, couleur, rugosite=0.5, metal=0.0, emission=None, force=0.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*couleur, 1.0)
    p.inputs["Roughness"].default_value = rugosite
    p.inputs["Metallic"].default_value = metal
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1.0)
        p.inputs["Emission Strength"].default_value = force
    return m


def srgb(h):
    """Couleur hexadécimale sRGB vers les valeurs linéaires attendues par Blender."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


M = {
    "Peinture": materiau("Peinture", srgb(0xF2B632), 0.32, 0.1),
    "Carbone": materiau("Carbone", srgb(0x24232B), 0.55, 0.2),
    "Bande": materiau("Bande", srgb(0xF6F3EE), 0.4),
    "Vitre": materiau("Vitre", srgb(0x1A1530), 0.06, 0.5),
    "Phares": materiau("Phares", srgb(0xFFF4DA), 0.2, 0.0, srgb(0xFFF4DA), 2.0),
    "Feux": materiau("Feux", srgb(0xFF2A1F), 0.3, 0.0, srgb(0xFF2A1F), 1.5),
    "Pneu": materiau("Pneu", srgb(0x1D1C22), 0.85),
    "Jante": materiau("Jante", srgb(0x3B3A44), 0.4, 0.2),
    "Accent": materiau("Accent", srgb(0xFFB23E), 0.4),
}


def objet(nom, bm, mat, lisse=True):
    me = bpy.data.meshes.new(nom)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = lisse
    o = bpy.data.objects.new(nom, me)
    scene.collection.objects.link(o)
    o.data.materials.append(M[mat])
    return o


def appliquer(o):
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def lissage(o, niveaux=2):
    s = o.modifiers.new("Lissage", "SUBSURF")
    s.levels = niveaux
    s.render_levels = niveaux


def biseau(o, largeur=0.02, segments=2):
    b = o.modifiers.new("Biseau", "BEVEL")
    b.width = largeur
    b.segments = segments
    b.limit_method = "ANGLE"


def boite(nom, mat_, taille, centre, rot=(0, 0, 0), bis=0.02):
    """Boîte (repère du jeu : largeur x, hauteur y, longueur z ; rotation en degrés autour de x, y, z du jeu)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = taille
    rx, ry, rz = (math.radians(a) for a in rot)
    mat = (
        Matrix.Translation(jeu(*centre))
        @ Matrix.Rotation(rx, 4, "X")
        @ Matrix.Rotation(-ry, 4, "Z")
        @ Matrix.Rotation(-rz, 4, "Y")
        @ Matrix.Diagonal((sx, sz, sy, 1.0))
    )
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
    o = objet(nom, bm, mat_, lisse=False)
    if bis:
        biseau(o, bis)
    return o


def loft(nom, mat, anneaux, plis=()):
    """Coque fermée à partir d'anneaux (liste de points du jeu), puis lissée. `plis` : indices de points à garder nets."""
    bm = bmesh.new()
    rings = [[bm.verts.new(jeu(*p)) for p in a] for a in anneaux]
    n = len(anneaux[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    crease = bm.edges.layers.float.new("crease_edge")
    for r in rings:
        for i in plis:
            for e in r[i].link_edges:
                other = e.other_vert(r[i])
                if any(other is rr[i] for rr in rings):
                    e[crease] = 0.85
    o = objet(nom, bm, mat)
    lissage(o, 2)
    return o


# ---------------------------------------------------------------- carrosserie
def section(z, hw, yb, ym, yt, yc):
    """Profil d'une tranche : bas, flanc, épaule (pli net), bord du capot, milieu du capot. Points dans le repère du jeu."""
    demi = [
        (hw * 0.82, yb),
        (hw, yb + 0.14),
        (hw * 1.0, ym),
        (hw * 0.8, yt),
        (hw * 0.4, (yt + yc) / 2 + 0.02),
    ]
    pts = [(0.0, yb - 0.01, z)]
    pts += [(x, y, z) for x, y in demi]
    pts.append((0.0, yc, z))
    pts += [(-x, y, z) for x, y in reversed(demi)]
    return pts


# De l'avant vers l'arrière : nez en coin, ailes avant bombées au-dessus des roues, taille fine,
# hanches larges au-dessus des roues arrière, poupe haute et coupée net.
SECTIONS = [
    section(2.44, 0.70, 0.30, 0.38, 0.42, 0.44),
    section(2.22, 1.00, 0.22, 0.76, 0.82, 0.58),
    section(1.90, 1.14, 0.20, 1.10, 1.15, 0.68),
    section(1.20, 1.14, 0.20, 1.10, 1.15, 0.76),
    section(0.80, 1.00, 0.20, 0.86, 0.92, 0.82),
    section(0.10, 0.98, 0.20, 0.86, 0.94, 0.88),
    section(-0.70, 1.06, 0.20, 1.02, 1.08, 0.96),
    section(-1.05, 1.18, 0.20, 1.24, 1.28, 1.00),
    section(-1.95, 1.18, 0.22, 1.24, 1.28, 1.02),
    section(-2.36, 1.00, 0.34, 1.10, 1.14, 1.02),
]
caisse = loft("Caisse", "Peinture", SECTIONS, plis=(3, 9))
appliquer(caisse)

# Passages de roues : on creuse la caisse avec des cylindres un peu plus grands que les roues
for nom, r in (("PassageAV", ROUE_AV), ("PassageAR", ROUE_AR)):
    for s in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r["r"] + 0.08, radius2=r["r"] + 0.08, depth=r["w"] + 0.6)
        bmesh.ops.transform(
            bm,
            matrix=Matrix.Translation(jeu(s * (r["x"] + 0.25), r["r"], r["z"])) @ Matrix.Rotation(math.pi / 2, 4, "Y"),
            verts=bm.verts,
        )
        cyl = objet(f"{nom}{s}", bm, "Carbone", lisse=False)
        b = caisse.modifiers.new("Passage", "BOOLEAN")
        b.operation = "DIFFERENCE"
        b.object = cyl
        b.solver = "EXACT"
        # Les faces creusées prennent le matériau du cylindre : l'intérieur des passages est sombre
        b.material_mode = "TRANSFER"
        appliquer(caisse)
        bpy.data.objects.remove(cyl)

# ---------------------------------------------------------------- cockpit
def bulle(z, w, base, haut):
    demi = [(w, base), (w * 0.94, base + (haut - base) * 0.55), (w * 0.6, haut - 0.02)]
    pts = [(0.0, base - 0.06, z)] + [(x, y, z) for x, y in demi] + [(0.0, haut, z)] + [(-x, y, z) for x, y in reversed(demi)]
    return pts


cockpit = loft(
    "Cockpit",
    "Vitre",
    [
        bulle(1.10, 0.26, 0.78, 0.82),
        bulle(0.55, 0.60, 0.80, 1.18),
        bulle(-0.25, 0.66, 0.84, 1.32),
        bulle(-0.95, 0.54, 0.90, 1.20),
        bulle(-1.35, 0.30, 0.95, 1.02),
    ],
)
appliquer(cockpit)

# Arceau derrière le cockpit, couleur carrosserie, prolongé par une dérive jusqu'à l'aileron
loft(
    "Derive",
    "Peinture",
    [
        [(0.0, 0.96, -0.9), (0.09, 1.0, -0.9), (0.05, 1.22, -0.9), (-0.05, 1.22, -0.9), (-0.09, 1.0, -0.9)],
        [(0.0, 0.98, -1.5), (0.07, 1.02, -1.5), (0.04, 1.26, -1.5), (-0.04, 1.26, -1.5), (-0.07, 1.02, -1.5)],
        [(0.0, 1.0, -2.0), (0.06, 1.04, -2.0), (0.035, 1.52, -2.0), (-0.035, 1.52, -2.0), (-0.06, 1.04, -2.0)],
    ],
)

# ---------------------------------------------------------------- détails
# Lame avant et bas de caisse
boite("Lame", "Carbone", (1.9, 0.06, 0.42), (0, 0.22, 2.26), rot=(-4, 0, 0))
for s in (1, -1):
    boite("Jupe", "Carbone", (0.12, 0.16, 1.5), (s * 1.0, 0.3, 0.05))
    # Prise d'air latérale derrière la roue avant, et filet blanc au-dessus
    boite("Ouie", "Carbone", (0.08, 0.26, 0.7), (s * 0.99, 0.6, 0.55), rot=(0, 0, 0), bis=0.03)
    boite("Filet", "Bande", (0.04, 0.04, 1.5), (s * 1.02, 0.82, 0.0), bis=0.012)
    # Phares : deux fentes en biais dans le nez
    boite("Phare", "Phares", (0.5, 0.08, 0.16), (s * 0.58, 0.6, 2.22), rot=(-28, s * 20, 0), bis=0.015)
    # Échappements
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.07, radius2=0.07, depth=0.2)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(jeu(s * 0.32, 0.5, -2.36)) @ Matrix.Rotation(math.pi / 2, 4, "X"), verts=bm.verts)
    objet("Echappement", bm, "Jante", lisse=False)
# Prise d'air dans le nez, grille sombre sous les feux arrière
boite("PriseAvant", "Carbone", (1.0, 0.14, 0.12), (0, 0.36, 2.38), rot=(-20, 0, 0), bis=0.03)
boite("GrilleArriere", "Carbone", (1.5, 0.26, 0.06), (0, 0.6, -2.38), bis=0.02)
# Diffuseur à ailettes
boite("Diffuseur", "Carbone", (1.7, 0.2, 0.2), (0, 0.36, -2.28))
for x in (-0.5, 0.0, 0.5):
    boite("Ailette", "Carbone", (0.04, 0.2, 0.32), (x, 0.3, -2.3), bis=0.008)
# Feux arrière : un bandeau sur toute la largeur
boite("Feux", "Feux", (1.74, 0.08, 0.04), (0, 0.84, -2.35), bis=0.01)
# Aileron : plan principal couleur carrosserie, bord de fuite blanc, flasques orange
boite("Aileron", "Peinture", (2.1, 0.07, 0.46), (0, 1.58, -2.02), rot=(-7, 0, 0), bis=0.025)
boite("AileronBord", "Bande", (2.1, 0.04, 0.12), (0, 1.61, -2.26), rot=(-20, 0, 0), bis=0.012)
for s in (1, -1):
    boite("Flasque", "Accent", (0.06, 0.32, 0.52), (s * 1.06, 1.54, -2.06), bis=0.02)
    boite("Mat", "Carbone", (0.07, 0.34, 0.2), (s * 0.45, 1.4, -2.0), rot=(-10, 0, 0), bis=0.015)

# Toute la caisse en un seul objet (moins d'appels de dessin dans le jeu)
corps = [o for o in scene.objects]
bpy.ops.object.select_all(action="DESELECT")
for o in corps:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    appliquer(o)
bpy.context.view_layer.objects.active = caisse
bpy.ops.object.join()
caisse.name = "Caisse"


# ---------------------------------------------------------------- roues
def roue(nom, r, w):
    """Roue centrée sur l'origine, axe le long de X (jeu), face extérieure vers +X."""
    pieces = []
    # Pneu : flancs arrondis
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r, radius2=r, depth=w)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.pi / 2, 4, "Y"), verts=bm.verts)
    p = objet(nom + "Pneu", bm, "Pneu")
    biseau(p, 0.07, 3)
    pieces.append(p)
    # Jante en retrait, dépasse légèrement du pneu côté extérieur
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r * 0.66, radius2=r * 0.66, depth=w * 0.2)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((w * 0.42, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=bm.verts)
    j = objet(nom + "Jante", bm, "Jante", lisse=False)
    biseau(j, 0.015)
    pieces.append(j)
    # Six branches fines et moyeu orange
    for k in range(6):
        a = k / 6 * math.tau
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.transform(
            bm,
            matrix=Matrix.Translation(Vector((w * 0.54, math.cos(a) * r * 0.33, math.sin(a) * r * 0.33)))
            @ Matrix.Rotation(-a, 4, "X")
            @ Matrix.Diagonal((0.05, 0.07, r * 0.58, 1)),
            verts=bm.verts,
        )
        b = objet(nom + "Branche", bm, "Bande", lisse=False)
        biseau(b, 0.01)
        pieces.append(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r * 0.17, radius2=r * 0.13, depth=0.1)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((w * 0.56, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=bm.verts)
    pieces.append(objet(nom + "Moyeu", bm, "Accent", lisse=False))
    # Liseré orange sur le flanc
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=32, radius=r * 0.86)
    ext = bmesh.ops.extrude_edge_only(bm, edges=bm.edges)
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co *= 0.92 / 0.86
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((w / 2 + 0.003, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y"), verts=bm.verts)
    pieces.append(objet(nom + "Lisere", bm, "Accent", lisse=False))
    bpy.ops.object.select_all(action="DESELECT")
    for o in pieces:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        appliquer(o)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    pieces[0].name = nom
    return pieces[0]


roue("RoueAvant", ROUE_AV["r"], ROUE_AV["w"])
roue("RoueArriere", ROUE_AR["r"], ROUE_AR["w"])

# ---------------------------------------------------------------- export
for o in scene.objects:
    print(f"{o.name}: {len(o.data.polygons)} faces")
os.makedirs(os.path.dirname(SORTIE_GLB), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=SORTIE_BLEND)
bpy.ops.export_scene.gltf(
    filepath=SORTIE_GLB,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_texcoords=False,
    export_normals=True,
)
print("Écrit", SORTIE_GLB, os.path.getsize(SORTIE_GLB), "octets")
