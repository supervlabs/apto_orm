module apto_orm_company::asset_factory {
    use apto_orm::orm_class;
    use apto_orm::orm_creator;
    use apto_orm::orm_module;
    use apto_orm::orm_object;
    use apto_orm::utilities;

    use aptos_framework::object::{Self, Object};
    use aptos_token_objects::token;
    use std::error;
    use std::vector;
    use std::option::{Self, Option};
    use std::string::{Self, String};

    const CLASS_NAME: vector<u8> = b"AssetFactory";
    const EMEMBERSHIP_OBJECT_NOT_FOUND: u64 = 1;
    const ENOT_ASSET_FACTORY_OBJECT: u64 = 2;

    struct AssetCreatorCap has key, drop {
        creator_cap: orm_creator::OrmCreatorCapability,
    }

    struct AssetFactory has key, copy, drop {}

    fun init_module(package: &signer) {
        let orm_creator_obj = object::address_to_object<orm_creator::OrmCreator>(@apto_orm_company);
        let creator_cap = orm_creator::generate_creator_capability(package, orm_creator_obj);
        move_to<AssetCreatorCap>(package, AssetCreatorCap { creator_cap });
    }

    entry fun update_module(_package_owner: &signer) {}

    entry fun init_collection(
        package_owner: &signer,
        collection_name: String,
        collection_uri: String,
        collection_description: String,
        collection_max_supply: u64,
        collection_royalty_present: bool,
        collection_royalty_payee: address,
        collection_royalty_denominator: u64,
        collection_royalty_numerator: u64,
        direct_transfer: bool,
        deletable_by_creator: bool,
        deletable_by_owner: bool,
        indirect_transfer_by_creator: bool,
        indirect_transfer_by_owner: bool,
        extensible_by_creator: bool,
        extensible_by_owner: bool,
    ) {
        let orm_creator_obj = object::address_to_object<orm_creator::OrmCreator>(@apto_orm_company);
        let orm_creator_signer = orm_creator::load_creator(package_owner, orm_creator_obj);
        let class_address = orm_class::update_class_as_collection<AssetFactory>(
            &orm_creator_signer,
            collection_name,
            direct_transfer, 
            deletable_by_creator, 
            deletable_by_owner,
            indirect_transfer_by_creator,
            indirect_transfer_by_owner,
            extensible_by_creator,
            extensible_by_owner,
            collection_uri,
            collection_description,
            collection_max_supply,
            true,
            collection_royalty_present,
            collection_royalty_payee,
            collection_royalty_denominator,
            collection_royalty_numerator,
        );
        orm_module::add_class<AssetFactory>(
            &orm_creator_signer,
            class_address,
        );
    }

    fun create_token(
        package_owner: &signer,
        collection_name: String,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
        metadata: vector<String>,
        to: Option<address>,
    ): Object<AssetFactory>{
        let orm_creator_obj = object::address_to_object<orm_creator::OrmCreator>(@apto_orm_company);
        let orm_class_obj = orm_class::get_class_object(@apto_orm_company, collection_name);
        let orm_creator_signer = orm_creator::load_creator(package_owner, orm_creator_obj);
        let numbered_token = false;
        let named_token = false;
        if (vector::length(&metadata) >= 1) {
            let command = vector::borrow(&metadata, 0);
            if (command == &string::utf8(b"numbered_token")) {
                numbered_token = true;
            } else if (command == &string::utf8(b"named_token")) {
                named_token = true;
            };
        };
        
        let ref = if (numbered_token) {
            token::create_numbered_token(
                &orm_creator_signer,
                collection_name,
                description,
                name,
                string::utf8(b""),
                option::none(),
                uri,
            )
        } else if (named_token) {
            let names = vector::slice(&metadata, 1, vector::length(&metadata)); // remove the first
            let ref = token::create_named_token(
                &orm_creator_signer,
                collection_name,
                description,
                utilities::join_str(
                    &string::utf8(b"::"),
                    &names,
                ),
                option::none(),
                uri,
            );
            let mutator_ref = token::generate_mutator_ref(&ref);
            token::set_name(&mutator_ref, name);
            ref
        } else {
            token::create(
                &orm_creator_signer,
                collection_name,
                description,
                name,
                option::none(),
                uri,
            )
        };
        orm_object::init_properties(
            &ref,
            property_keys,
            property_types,
            property_values,
        );
        let object_signer = orm_object::init<AssetFactory>(&orm_creator_signer, &ref, orm_class_obj);
        move_to<AssetFactory>(&object_signer, AssetFactory {});
        if (option::is_some(&to)) {
            let destination = option::extract<address>(&mut to);
            orm_object::transfer_initially(&ref, destination);
        };
        object::object_from_constructor_ref<AssetFactory>(&ref)
    }

    fun update_token<T: key>(
        package_owner: &signer,
        object: Object<T>,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
    ) {
        let object_address = object::object_address(&object);
        assert!(
            exists<AssetFactory>(object_address),
            error::invalid_argument(ENOT_ASSET_FACTORY_OBJECT),
        );
        orm_object::update_all_fields(
            package_owner, object, name, uri, description,
            property_keys, property_types, property_values,
        );
    }

    fun delete_token<T: key>(
        package_owner: &signer,
        object: Object<T>,
    ) acquires AssetFactory {
        let object_address = object::object_address(&object);
        assert!(
          exists<AssetFactory>(object_address),
          error::invalid_argument(ENOT_ASSET_FACTORY_OBJECT),
        );
        move_from<AssetFactory>(object_address);
        orm_object::remove(package_owner, object);
    }

    entry fun create(
        package_owner: &signer,
        collection_name: String,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
        metadata: vector<String>,
    ) {
        create_token(
            package_owner,
            collection_name,
            name,
            uri,
            description,
            property_keys,
            property_types,
            property_values,
            metadata,
            option::none(),
        );
    }

    entry fun create_to(
        package_owner: &signer,
        collection_name: String,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
        metadata: vector<String>,
        to: address,
    ) {
        create_token(
            package_owner,
            collection_name,
            name,
            uri,
            description,
            property_keys,
            property_types,
            property_values,
            metadata,
            option::some(to),
        );
    }

    entry fun update(
        package_owner: &signer,
        object: address,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
        _metadata: vector<String>,
    ) {
        let obj = object::address_to_object<AssetFactory>(object);
        update_token(
            package_owner,
            obj,
            name,
            uri,
            description,
            property_keys,
            property_types,
            property_values,
        );
    }

    entry fun delete(
        package_owner: &signer,
        object: address,
        _metadata: vector<String>,
    ) acquires AssetFactory {
        let obj = object::address_to_object<AssetFactory>(object);
        delete_token(package_owner, obj);
    }

    #[view]
    public fun get(object: address): (String, String, String) {
        let o = object::address_to_object<AssetFactory>(object);
        (
            token::name(o),
            token::uri(o),
            token::description(o),
        )
    }

    #[view]
    public fun exists_at(object: address): bool {
        exists<AssetFactory>(object)
    }

    // add bulk creation, burn and update...?
    // preset for default properties
}